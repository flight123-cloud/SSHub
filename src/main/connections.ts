import { BrowserWindow, type WebContents } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { Encoding, FileEntry, Protocol, TextFile, TransferDirection, TransferItem } from '../shared/types'
import { decode, encode, isValidUtf8, looksBinary } from './encoding'
import { friendlyError } from './errors'
import type { RemoteFs } from './remotefs'

/** 一个打开的连接：SSH（终端 + SFTP）或 FTP（仅文件） */
export interface Conn {
  id: string
  protocol: Protocol
  title: string
  homeDir: string
  /** 服务器字符编码（终端、FTP 文件名、文本文件默认编码） */
  encoding: Encoding
  closed: boolean
  /** 浏览 / 文件操作用 */
  fs: RemoteFs
  /** 传输专用（可单独中断，不影响浏览） */
  xfer: RemoteFs
  /** 断开连接 */
  end: () => void
  /** 发起这条连接的窗口：终端数据、传输进度只发给它 */
  owner: WebContents
  queue: TransferItem[]
  running?: TransferItem
}

const conns = new Map<string, Conn>()

export function sendTo(wc: WebContents | undefined, channel: string, ...args: unknown[]): void {
  if (wc && !wc.isDestroyed()) wc.send(channel, ...args)
}

/** 发给所有窗口（例如设置变化） */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) sendTo(w.webContents, channel, ...args)
}

/** 连接 ID → 所属窗口（连接关闭后仍保留，便于发送最后的传输状态） */
const owners = new Map<string, WebContents>()
export function ownerOf(connId: string): WebContents | undefined {
  return owners.get(connId)
}

export function register(c: Omit<Conn, 'id' | 'closed' | 'queue'>): Conn {
  const conn: Conn = { ...c, id: randomUUID(), closed: false, queue: [] }
  conns.set(conn.id, conn)
  owners.set(conn.id, c.owner)
  // 窗口关闭时断开它的所有连接
  c.owner.once('destroyed', () => {
    disconnect(conn.id)
    owners.delete(conn.id)
  })
  return conn
}

const closeListeners: ((connId: string) => void)[] = []
export function onConnectionClosed(l: (connId: string) => void): void {
  closeListeners.push(l)
}

/** 连接已断开：标记、终止排队中的传输并移除 */
export function markClosed(conn: Conn): void {
  if (conn.closed) return
  conn.closed = true
  closeListeners.forEach((l) => l(conn.id))
  for (const t of conn.queue) {
    if (t.status === 'queued' || t.status === 'running') {
      t.status = 'error'
      t.error = '连接已断开'
      emitTransfer(t)
    }
  }
  try {
    conn.fs.close()
    conn.xfer.close()
  } catch {
    /* ignore */
  }
  conns.delete(conn.id)
}

export function get(connId: string): Conn | undefined {
  return conns.get(connId)
}

function need(connId: string): Conn {
  const c = conns.get(connId)
  if (!c || c.closed) throw new Error('连接已断开')
  return c
}

export function disconnect(connId: string): void {
  const c = conns.get(connId)
  if (!c) return
  try {
    c.end()
  } catch {
    /* ignore */
  }
  markClosed(c)
}

export function disconnectAll(): void {
  for (const id of [...conns.keys()]) disconnect(id)
}

/* ---------------- 文件操作 ---------------- */

export const remote = {
  list: (id: string, dir: string): Promise<FileEntry[]> => need(id).fs.list(dir),
  realpath: (id: string, p: string): Promise<string> => need(id).fs.realpath(p),
  mkdir: (id: string, p: string): Promise<void> => need(id).fs.mkdir(p),
  rename: (id: string, a: string, b: string): Promise<void> => need(id).fs.rename(a, b),
  chmod: (id: string, p: string, mode: number): Promise<void> => need(id).fs.chmod(p, mode),
  async remove(id: string, paths: string[]): Promise<void> {
    const f = need(id).fs
    for (const p of paths) await f.remove(p)
  },
  copy: (id: string, src: string, dest: string): Promise<void> => need(id).fs.copy(src, dest),

  /**
   * 打开文本文件：自动识别编码（合法 UTF-8 → UTF-8，否则用会话编码，会话是 UTF-8 时再试 GBK），
   * 保留 BOM 与换行符风格；疑似二进制文件拒绝打开。
   */
  async openText(id: string, p: string, want?: Encoding): Promise<TextFile> {
    const c = need(id)
    const st = await c.fs.stat(p)
    if (st.isDir) throw new Error('这是一个文件夹')
    if (st.size > MAX_EDIT_SIZE) throw new Error('文件超过 10MB，请下载后编辑或「用本地应用打开」')
    let buf = await c.fs.readFile(p)
    if (looksBinary(buf)) throw new Error('这看起来是二进制文件，不能用文本编辑器打开。可以右键选择「用本地应用打开」')
    let bom = false
    if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      bom = true
      buf = buf.subarray(3)
    }
    let encoding: Encoding
    if (want) encoding = want
    else if (bom || isValidUtf8(buf)) encoding = 'utf8'
    else encoding = c.encoding !== 'utf8' ? c.encoding : 'gbk'
    const text = decode(buf, encoding)
    return { text, encoding, bom: bom && encoding === 'utf8', eol: /\r\n/.test(text) ? 'crlf' : 'lf', size: st.size }
  },

  async saveText(id: string, p: string, text: string, encoding: Encoding, bom: boolean): Promise<void> {
    let buf = encode(text, encoding)
    if (encoding !== 'utf8' && decode(buf, encoding) !== text) {
      throw new Error(`内容中有无法用 ${encoding.toUpperCase()} 表示的字符，请改用 UTF-8 保存`)
    }
    if (bom && encoding === 'utf8') buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), buf])
    await need(id).fs.writeFile(p, buf)
  }
}

const MAX_EDIT_SIZE = 10 * 1024 * 1024

/* ---------------- 传输队列 ---------------- */

const lastEmit = new Map<string, number>()
export function emitTransfer(t: TransferItem, force = true): void {
  const now = Date.now()
  if (!force && now - (lastEmit.get(t.id) ?? 0) < 150) return
  lastEmit.set(t.id, now)
  if (t.status === 'done' || t.status === 'error' || t.status === 'canceled') lastEmit.delete(t.id)
  sendTo(owners.get(t.connId), 'transfer:update', { ...t })
}

export function enqueueTransfer(
  connId: string,
  direction: TransferDirection,
  srcPaths: string[],
  destDir: string
): TransferItem[] {
  const conn = need(connId)
  const items = srcPaths.map<TransferItem>((src) => ({
    id: randomUUID(),
    connId,
    direction,
    name: direction === 'upload' ? path.basename(src) : path.posix.basename(src),
    src,
    dest:
      direction === 'upload'
        ? path.posix.join(destDir, path.basename(src))
        : path.join(destDir, path.posix.basename(src)),
    total: 0,
    transferred: 0,
    status: 'queued'
  }))
  conn.queue.push(...items)
  items.forEach((t) => emitTransfer(t))
  void pump(conn)
  return items
}

export function cancelTransfer(id: string): void {
  for (const conn of conns.values()) {
    const t = conn.queue.find((x) => x.id === id)
    if (!t) continue
    if (t.status === 'queued') {
      t.status = 'canceled'
      emitTransfer(t)
    } else if (t.status === 'running') {
      t.status = 'canceled'
      conn.xfer.abort()
      emitTransfer(t)
    }
  }
}

interface FileJob {
  src: string
  dest: string
  size: number
}

async function planUpload(src: string, dest: string): Promise<{ dirs: string[]; files: FileJob[] }> {
  const dirs: string[] = []
  const files: FileJob[] = []
  const walk = async (s: string, d: string): Promise<void> => {
    const st = await fs.promises.stat(s)
    if (st.isDirectory()) {
      dirs.push(d)
      for (const name of await fs.promises.readdir(s)) {
        if (name === '.DS_Store') continue
        await walk(path.join(s, name), path.posix.join(d, name))
      }
    } else if (st.isFile()) {
      files.push({ src: s, dest: d, size: st.size })
    }
  }
  await walk(src, dest)
  return { dirs, files }
}

async function planDownload(rfs: RemoteFs, src: string, dest: string): Promise<{ dirs: string[]; files: FileJob[] }> {
  const dirs: string[] = []
  const files: FileJob[] = []
  const walk = async (s: string, d: string, known?: { isDir: boolean; size: number }): Promise<void> => {
    const st = known ?? (await rfs.stat(s))
    if (st.isDir) {
      dirs.push(d)
      for (const f of await rfs.list(s)) {
        await walk(f.path, path.join(d, f.name), f.isLink ? undefined : { isDir: f.isDir, size: f.size })
      }
    } else {
      files.push({ src: s, dest: d, size: st.size })
    }
  }
  await walk(src, dest)
  return { dirs, files }
}

async function runTransfer(conn: Conn, t: TransferItem): Promise<void> {
  const rfs = conn.xfer
  const plan = t.direction === 'upload' ? await planUpload(t.src, t.dest) : await planDownload(rfs, t.src, t.dest)
  t.total = plan.files.reduce((a, f) => a + f.size, 0)
  emitTransfer(t)

  for (const d of plan.dirs) {
    if (t.status === 'canceled') return
    if (t.direction === 'upload') await rfs.mkdir(d).catch(() => undefined)
    else await fs.promises.mkdir(d, { recursive: true })
  }

  let doneBytes = 0
  const started = Date.now()
  for (const f of plan.files) {
    if (t.status === 'canceled') return
    const onProgress = (bytes: number): void => {
      t.transferred = doneBytes + bytes
      const secs = (Date.now() - started) / 1000
      t.speed = secs > 0 ? t.transferred / secs : 0
      emitTransfer(t, false)
    }
    try {
      if (t.direction === 'upload') await rfs.upload(f.src, f.dest, onProgress)
      else await rfs.download(f.src, f.dest, onProgress)
    } catch (err) {
      // 取消时删除不完整的文件
      if ((t.status as TransferItem['status']) === 'canceled') {
        if (t.direction === 'download') await fs.promises.unlink(f.dest).catch(() => undefined)
        else await rfs.remove(f.dest).catch(() => undefined)
      }
      throw err
    }
    doneBytes += f.size
    t.transferred = doneBytes
  }
}

async function pump(conn: Conn): Promise<void> {
  if (conn.running) return
  for (;;) {
    const t = conn.queue.find((x) => x.status === 'queued')
    if (!t || conn.closed) break
    conn.running = t
    t.status = 'running'
    t.startedAt = Date.now()
    emitTransfer(t)
    try {
      await runTransfer(conn, t)
      if (t.status === 'running') {
        t.status = 'done'
        t.transferred = t.total
      }
    } catch (err) {
      if ((t.status as TransferItem['status']) !== 'canceled') {
        t.status = 'error'
        t.error = friendlyError(err)
      }
    }
    t.finishedAt = Date.now()
    emitTransfer(t)
    conn.running = undefined
  }
  // 清理已完成项，避免内存增长
  conn.queue = conn.queue.filter((x) => x.status === 'queued' || x.status === 'running')
}
