import { BrowserWindow, dialog } from 'electron'
import { Client, type ClientChannel, type ConnectConfig, type SFTPWrapper, type FileEntryWithStats } from 'ssh2'
import { createHash, randomUUID } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type {
  ConnectRequest,
  ConnectResult,
  FileEntry,
  TransferItem,
  TransferDirection
} from '../shared/types'
import { knownHosts, sessionStore } from './store'

interface Conn {
  id: string
  client: Client
  shell?: ClientChannel
  sftp?: SFTPWrapper
  sftpPending?: Promise<SFTPWrapper>
  /** 传输专用 SFTP 通道（可单独关闭以取消传输） */
  xferSftp?: SFTPWrapper
  xferPending?: Promise<SFTPWrapper>
  homeDir: string
  title: string
  closed: boolean
  queue: TransferItem[]
  running?: TransferItem
  cancelRunning?: () => void
}

const conns = new Map<string, Conn>()

function send(win: BrowserWindow | null, channel: string, ...args: unknown[]): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

let mainWindow: BrowserWindow | null = null
export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

function friendlyError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { level?: string }
  const msg = e?.message || String(err)
  if (e?.code === 'ECONNREFUSED') return '连接被拒绝：请检查主机地址和端口，以及服务器上的 SSH 服务是否运行'
  if (e?.code === 'ENOTFOUND' || e?.code === 'EAI_AGAIN') return '无法解析主机名：请检查主机地址'
  if (e?.code === 'ETIMEDOUT' || /Timed out/i.test(msg)) return '连接超时：请检查网络或防火墙设置'
  if (e?.code === 'EHOSTUNREACH' || e?.code === 'ENETUNREACH') return '主机不可达：请检查网络'
  if (e?.code === 'ECONNRESET') return '连接被服务器重置'
  if (/All configured authentication methods failed/i.test(msg)) return '认证失败：用户名、密码或密钥不正确'
  if (/Cannot parse privateKey|Encrypted private (OpenSSH )?key detected/i.test(msg))
    return '私钥无法解析：如果私钥有口令，请在会话设置中填写口令'
  if (/Host key verification/i.test(msg) || /host.*denied/i.test(msg)) return '已取消：主机密钥未被信任'
  if (e?.code === 'ENOENT') return '文件不存在：' + (e.path || msg)
  if (e?.code === 'EACCES' || (e as { code?: unknown })?.code === 3) return '权限不足：' + msg
  return msg
}

export { friendlyError }

/** 主机指纹校验：首次连接询问，变更时警告 */
function makeHostVerifier(hostPort: string) {
  return (key: Buffer, verify: (ok: boolean) => void): void => {
    const fp = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
    const known = knownHosts.get(hostPort)
    if (known === fp) return verify(true)
    const win = mainWindow ?? undefined
    const changed = !!known
    const opts: Electron.MessageBoxOptions = changed
      ? {
          type: 'warning',
          title: '主机密钥已变更',
          message: `警告：${hostPort} 的主机密钥与之前保存的不一致！`,
          detail: `这可能意味着有人在进行中间人攻击，也可能是服务器重装了系统。\n\n旧指纹：${known}\n新指纹：${fp}\n\n确定要信任新的密钥并继续连接吗？`,
          buttons: ['取消', '信任并继续'],
          defaultId: 0,
          cancelId: 0
        }
      : {
          type: 'question',
          title: '未知主机',
          message: `首次连接 ${hostPort}`,
          detail: `服务器主机密钥指纹：\n${fp}\n\n是否信任该主机并继续连接？`,
          buttons: ['取消', '信任并连接'],
          defaultId: 1,
          cancelId: 0
        }
    const p = win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)
    p.then((r) => {
      if (r.response === 1) {
        knownHosts.set(hostPort, fp)
        verify(true)
      } else verify(false)
    }).catch(() => verify(false))
  }
}

async function buildConfig(req: ConnectRequest): Promise<{ cfg: ConnectConfig; title: string; password?: string }> {
  if (req.sessionId) {
    const s = await sessionStore.getSecret(req.sessionId)
    if (!s) throw new Error('会话不存在')
    const password = req.password || s.plainPassword
    const cfg: ConnectConfig = {
      host: s.host,
      port: s.port,
      username: s.username,
      readyTimeout: 20000,
      keepaliveInterval: 30000,
      keepaliveCountMax: 4,
      tryKeyboard: true,
      hostVerifier: makeHostVerifier(`${s.host}:${s.port}`)
    }
    if (s.authType === 'password') {
      cfg.password = password
    } else if (s.authType === 'key') {
      const keyPath = expandHome(s.privateKeyPath || '~/.ssh/id_ed25519')
      try {
        cfg.privateKey = fs.readFileSync(keyPath)
      } catch {
        throw new Error('无法读取私钥文件：' + keyPath)
      }
      if (s.plainPassphrase) cfg.passphrase = s.plainPassphrase
      if (password) cfg.password = password
    } else if (s.authType === 'agent') {
      cfg.agent = process.env.SSH_AUTH_SOCK
      if (!cfg.agent) throw new Error('未检测到 SSH Agent（SSH_AUTH_SOCK 为空）')
    }
    sessionStore.touch(s.id)
    return { cfg, title: s.name, password }
  }
  if (req.quick) {
    const q = req.quick
    const cfg: ConnectConfig = {
      host: q.host,
      port: q.port || 22,
      username: q.username,
      password: q.password,
      readyTimeout: 20000,
      keepaliveInterval: 30000,
      keepaliveCountMax: 4,
      tryKeyboard: true,
      hostVerifier: makeHostVerifier(`${q.host}:${q.port || 22}`)
    }
    // 快速连接且未填密码时，尝试系统 SSH Agent 与默认私钥
    if (!q.password) {
      if (process.env.SSH_AUTH_SOCK) cfg.agent = process.env.SSH_AUTH_SOCK
      for (const f of ['id_ed25519', 'id_ecdsa', 'id_rsa']) {
        const p = path.join(os.homedir(), '.ssh', f)
        if (fs.existsSync(p)) {
          try {
            cfg.privateKey = fs.readFileSync(p)
            break
          } catch {
            /* ignore */
          }
        }
      }
    }
    return { cfg, title: `${q.username}@${q.host}`, password: q.password }
  }
  throw new Error('缺少连接参数')
}

export async function connect(req: ConnectRequest): Promise<ConnectResult> {
  const { cfg, title, password } = await buildConfig(req)
  const client = new Client()
  const id = randomUUID()

  client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
    // 常见的 keyboard-interactive 只问密码
    finish(prompts.map(() => password ?? ''))
  })

  await new Promise<void>((resolve, reject) => {
    let settled = false
    client.once('ready', () => {
      settled = true
      resolve()
    })
    client.once('error', (err) => {
      if (!settled) {
        settled = true
        reject(new Error(friendlyError(err)))
      }
    })
    client.once('close', () => {
      if (!settled) {
        settled = true
        reject(new Error('连接已关闭'))
      }
    })
    try {
      client.connect(cfg)
    } catch (err) {
      settled = true
      reject(new Error(friendlyError(err)))
    }
  })

  const conn: Conn = { id, client, homeDir: '/', title, closed: false, queue: [] }
  conns.set(id, conn)

  client.on('error', (err) => {
    send(mainWindow, 'ssh:error', id, friendlyError(err))
  })
  client.on('close', () => {
    conn.closed = true
    send(mainWindow, 'ssh:closed', id)
    for (const t of conn.queue) {
      if (t.status === 'queued' || t.status === 'running') {
        t.status = 'error'
        t.error = '连接已断开'
        emitTransfer(t)
      }
    }
    conns.delete(id)
  })

  // 打开交互式 Shell
  conn.shell = await new Promise<ClientChannel>((resolve, reject) => {
    client.shell(
      { term: 'xterm-256color', cols: req.cols || 80, rows: req.rows || 24 },
      { env: { LANG: process.env.LANG || 'en_US.UTF-8', LC_CTYPE: 'UTF-8' } },
      (err, stream) => (err ? reject(new Error(friendlyError(err))) : resolve(stream))
    )
  })
  conn.shell.on('data', (d: Buffer) => send(mainWindow, 'ssh:data', id, new Uint8Array(d)))
  conn.shell.stderr.on('data', (d: Buffer) => send(mainWindow, 'ssh:data', id, new Uint8Array(d)))
  conn.shell.on('close', () => {
    send(mainWindow, 'ssh:shell-closed', id)
    client.end()
  })

  // 预先获取远程 home 目录
  try {
    const sftp = await getSftp(conn)
    conn.homeDir = await new Promise<string>((res) => sftp.realpath('.', (e, p) => res(e ? '/' : p)))
  } catch {
    /* 部分服务器不支持 SFTP，忽略 */
  }

  return { connId: id, title, homeDir: conn.homeDir }
}

function need(connId: string): Conn {
  const c = conns.get(connId)
  if (!c || c.closed) throw new Error('连接已断开')
  return c
}

function openSftp(conn: Conn): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    conn.client.sftp((err, sftp) => {
      if (err) reject(new Error('无法打开 SFTP 通道：' + friendlyError(err)))
      else resolve(sftp)
    })
  })
}

function getSftp(conn: Conn): Promise<SFTPWrapper> {
  if (conn.sftp) return Promise.resolve(conn.sftp)
  if (!conn.sftpPending) {
    conn.sftpPending = openSftp(conn)
      .then((s) => {
        conn.sftp = s
        s.on('close', () => {
          conn.sftp = undefined
          conn.sftpPending = undefined
        })
        return s
      })
      .catch((e) => {
        conn.sftpPending = undefined
        throw e
      })
  }
  return conn.sftpPending
}

function getXferSftp(conn: Conn): Promise<SFTPWrapper> {
  if (conn.xferSftp) return Promise.resolve(conn.xferSftp)
  if (!conn.xferPending) {
    conn.xferPending = openSftp(conn)
      .then((s) => {
        conn.xferSftp = s
        s.on('close', () => {
          conn.xferSftp = undefined
          conn.xferPending = undefined
        })
        return s
      })
      .catch((e) => {
        conn.xferPending = undefined
        throw e
      })
  }
  return conn.xferPending
}

export function write(connId: string, data: string): void {
  conns.get(connId)?.shell?.write(data)
}

export function resize(connId: string, cols: number, rows: number): void {
  const c = conns.get(connId)
  if (c?.shell && cols > 0 && rows > 0) c.shell.setWindow(rows, cols, 0, 0)
}

export function disconnect(connId: string): void {
  const c = conns.get(connId)
  if (!c) return
  try {
    c.client.end()
  } catch {
    /* ignore */
  }
}

export function disconnectAll(): void {
  for (const id of [...conns.keys()]) disconnect(id)
}

/* ---------------- SFTP 文件操作 ---------------- */

function permString(mode: number): string {
  const type = (mode & 0o170000) === 0o040000 ? 'd' : (mode & 0o170000) === 0o120000 ? 'l' : '-'
  const bits = 'rwxrwxrwx'
  let s = ''
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? bits[i] : '-'
  return type + s
}

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

function sftpCall<T>(fn: (cb: (err: Error | null | undefined, res?: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, res) => (err ? reject(new Error(friendlyError(err))) : resolve(res as T)))
  })
}

export async function remoteList(connId: string, dir: string): Promise<FileEntry[]> {
  const conn = need(connId)
  const sftp = await getSftp(conn)
  const list = await sftpCall<FileEntryWithStats[]>((cb) => sftp.readdir(dir, cb))
  const out: FileEntry[] = []
  await Promise.all(
    list.map(async (f) => {
      const full = path.posix.join(dir, f.filename)
      const mode = f.attrs.mode ?? 0
      const isLink = (mode & S_IFMT) === S_IFLNK
      let isDir = (mode & S_IFMT) === S_IFDIR
      let size = f.attrs.size ?? 0
      if (isLink) {
        try {
          const st = await sftpCall<{ mode: number; size: number }>((cb) => sftp.stat(full, cb))
          isDir = (st.mode & S_IFMT) === S_IFDIR
          size = st.size
        } catch {
          /* 失效的链接 */
        }
      }
      out.push({
        name: f.filename,
        path: full,
        isDir,
        isLink,
        size,
        mtime: (f.attrs.mtime ?? 0) * 1000,
        mode,
        perm: permString(mode)
      })
    })
  )
  return out
}

export async function remoteRealpath(connId: string, p: string): Promise<string> {
  const conn = need(connId)
  const sftp = await getSftp(conn)
  return sftpCall<string>((cb) => sftp.realpath(p, cb))
}

export async function remoteMkdir(connId: string, p: string): Promise<void> {
  const sftp = await getSftp(need(connId))
  await sftpCall<void>((cb) => sftp.mkdir(p, cb))
}

export async function remoteRename(connId: string, from: string, to: string): Promise<void> {
  const sftp = await getSftp(need(connId))
  await sftpCall<void>((cb) => sftp.rename(from, to, cb))
}

export async function remoteChmod(connId: string, p: string, mode: number): Promise<void> {
  const sftp = await getSftp(need(connId))
  await sftpCall<void>((cb) => sftp.chmod(p, mode, cb))
}

async function remoteRemoveRec(sftp: SFTPWrapper, p: string): Promise<void> {
  const st = await sftpCall<{ mode: number }>((cb) => sftp.lstat(p, cb))
  if ((st.mode & S_IFMT) === S_IFDIR) {
    const list = await sftpCall<FileEntryWithStats[]>((cb) => sftp.readdir(p, cb))
    for (const f of list) await remoteRemoveRec(sftp, path.posix.join(p, f.filename))
    await sftpCall<void>((cb) => sftp.rmdir(p, cb))
  } else {
    await sftpCall<void>((cb) => sftp.unlink(p, cb))
  }
}

export async function remoteDelete(connId: string, paths: string[]): Promise<void> {
  const sftp = await getSftp(need(connId))
  for (const p of paths) await remoteRemoveRec(sftp, p)
}

/** 读取小文本文件（用于在线编辑） */
export async function remoteReadText(connId: string, p: string): Promise<string> {
  const sftp = await getSftp(need(connId))
  const st = await sftpCall<{ size: number }>((cb) => sftp.stat(p, cb))
  if (st.size > 5 * 1024 * 1024) throw new Error('文件超过 5MB，请下载后编辑')
  const buf = await sftpCall<Buffer>((cb) => sftp.readFile(p, cb as never))
  return buf.toString('utf8')
}

export async function remoteWriteText(connId: string, p: string, content: string): Promise<void> {
  const sftp = await getSftp(need(connId))
  await sftpCall<void>((cb) => sftp.writeFile(p, content, 'utf8' as never, cb))
}

/* ---------------- 传输队列 ---------------- */

const lastEmit = new Map<string, number>()
function emitTransfer(t: TransferItem, force = true): void {
  const now = Date.now()
  if (!force && now - (lastEmit.get(t.id) ?? 0) < 150) return
  lastEmit.set(t.id, now)
  if (t.status === 'done' || t.status === 'error' || t.status === 'canceled') lastEmit.delete(t.id)
  send(mainWindow, 'transfer:update', { ...t })
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
      conn.cancelRunning?.()
      emitTransfer(t)
    }
  }
}

interface FileJob {
  src: string
  dest: string
  size: number
}

async function planUpload(sftp: SFTPWrapper, src: string, dest: string): Promise<{ dirs: string[]; files: FileJob[] }> {
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
  void sftp
  await walk(src, dest)
  return { dirs, files }
}

async function planDownload(sftp: SFTPWrapper, src: string, dest: string): Promise<{ dirs: string[]; files: FileJob[] }> {
  const dirs: string[] = []
  const files: FileJob[] = []
  const walk = async (s: string, d: string): Promise<void> => {
    const st = await sftpCall<{ mode: number; size: number }>((cb) => sftp.stat(s, cb))
    if ((st.mode & S_IFMT) === S_IFDIR) {
      dirs.push(d)
      const list = await sftpCall<FileEntryWithStats[]>((cb) => sftp.readdir(s, cb))
      for (const f of list) await walk(path.posix.join(s, f.filename), path.join(d, f.filename))
    } else {
      files.push({ src: s, dest: d, size: st.size })
    }
  }
  await walk(src, dest)
  return { dirs, files }
}

async function runTransfer(conn: Conn, t: TransferItem): Promise<void> {
  const sftp = await getXferSftp(conn)
  const plan = t.direction === 'upload' ? await planUpload(sftp, t.src, t.dest) : await planDownload(sftp, t.src, t.dest)
  t.total = plan.files.reduce((a, f) => a + f.size, 0)
  emitTransfer(t)

  for (const d of plan.dirs) {
    if (t.status === 'canceled') return
    if (t.direction === 'upload') {
      await sftpCall<void>((cb) => sftp.mkdir(d, cb)).catch(() => undefined)
    } else {
      await fs.promises.mkdir(d, { recursive: true })
    }
  }

  let doneBytes = 0
  const started = Date.now()
  for (const f of plan.files) {
    if (t.status === 'canceled') return
    await new Promise<void>((resolve, reject) => {
      conn.cancelRunning = (): void => {
        // 关闭传输通道即可中断 fastPut/fastGet
        try {
          sftp.end()
        } catch {
          /* ignore */
        }
        reject(new Error('已取消'))
      }
      const opts = {
        concurrency: 64,
        chunkSize: 32768,
        step: (transferred: number): void => {
          t.transferred = doneBytes + transferred
          const secs = (Date.now() - started) / 1000
          t.speed = secs > 0 ? t.transferred / secs : 0
          emitTransfer(t, false)
        }
      }
      const cb = (err: Error | null | undefined): void => (err ? reject(err) : resolve())
      if (t.direction === 'upload') sftp.fastPut(f.src, f.dest, opts, cb)
      else sftp.fastGet(f.src, f.dest, opts, cb)
    }).catch(async (err) => {
      // 取消时删除不完整的文件
      if ((t.status as TransferItem['status']) === 'canceled') {
        if (t.direction === 'download') await fs.promises.unlink(f.dest).catch(() => undefined)
        else {
          const s2 = await getXferSftp(conn).catch(() => null)
          if (s2) await sftpCall<void>((cb) => s2.unlink(f.dest, cb)).catch(() => undefined)
        }
      }
      throw err
    })
    doneBytes += f.size
    t.transferred = doneBytes
  }
  conn.cancelRunning = undefined
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
    conn.cancelRunning = undefined
    t.finishedAt = Date.now()
    emitTransfer(t)
    conn.running = undefined
  }
  // 清理已完成项，避免内存增长
  conn.queue = conn.queue.filter((x) => x.status === 'queued' || x.status === 'running')
}
