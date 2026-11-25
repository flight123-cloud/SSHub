import { BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { FileEntry, Protocol, TransferDirection, TransferItem } from '../shared/types'
import { friendlyError } from './errors'
import type { RemoteFs } from './remotefs'

/** 一个打开的连接：SSH（终端 + SFTP）或 FTP（仅文件） */
export interface Conn {
  id: string
  protocol: Protocol
  title: string
  homeDir: string
  closed: boolean
  /** 浏览 / 文件操作用 */
  fs: RemoteFs
  /** 传输专用（可单独中断，不影响浏览） */
  xfer: RemoteFs
  /** 断开连接 */
  end: () => void
  queue: TransferItem[]
  running?: TransferItem
}

const conns = new Map<string, Conn>()

let mainWindow: BrowserWindow | null = null
export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}
export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}
export function send(channel: string, ...args: unknown[]): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, ...args)
}

export function register(c: Omit<Conn, 'id' | 'closed' | 'queue'>): Conn {
  const conn: Conn = { ...c, id: randomUUID(), closed: false, queue: [] }
  conns.set(conn.id, conn)
  return conn
}

/** 连接已断开：标记、终止排队中的传输并移除 */
export function markClosed(conn: Conn): void {
  if (conn.closed) return
  conn.closed = true
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
  async readText(id: string, p: string): Promise<string> {
    const f = need(id).fs
    const st = await f.stat(p)
    if (st.size > 5 * 1024 * 1024) throw new Error('文件超过 5MB，请下载后编辑')
    return (await f.readFile(p)).toString('utf8')
  },
  writeText: (id: string, p: string, content: string): Promise<void> =>
    need(id).fs.writeFile(p, Buffer.from(content, 'utf8'))
}

/* ---------------- 传输队列 ---------------- */

const lastEmit = new Map<string, number>()
export function emitTransfer(t: TransferItem, force = true): void {
  const now = Date.now()
  if (!force && now - (lastEmit.get(t.id) ?? 0) < 150) return
  lastEmit.set(t.id, now)
  if (t.status === 'done' || t.status === 'error' || t.status === 'canceled') lastEmit.delete(t.id)
  send('transfer:update', { ...t })
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
