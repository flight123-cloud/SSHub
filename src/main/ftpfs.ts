import { Client, type AccessOptions, type FileInfo } from 'basic-ftp'
import path from 'path'
import { Readable, Writable } from 'stream'
import type { Encoding, FileEntry, FtpSecurity } from '../shared/types'
import { fromWire, toWire } from './encoding'
import { friendlyError } from './errors'
import { copyViaReadWrite, permString, type RemoteFs, type RemoteStat } from './remotefs'

export interface FtpConfig {
  host: string
  port: number
  user: string
  password: string
  security: FtpSecurity
  ignoreCert: boolean
  encoding: Encoding
}

function toAccess(c: FtpConfig): AccessOptions {
  return {
    host: c.host,
    port: c.port,
    user: c.user,
    password: c.password,
    secure: c.security === 'none' ? false : c.security === 'implicit' ? 'implicit' : true,
    secureOptions: { rejectUnauthorized: !c.ignoreCert, servername: c.host }
  }
}

function wrap(err: unknown): Error {
  return new Error(friendlyError(err))
}

/**
 * 基于 basic-ftp 的远程文件系统。
 * basic-ftp 同一时刻只能执行一个命令，因此所有操作串行排队；
 * 连接被服务器断开（例如空闲超时）后，下一次操作会自动重连。
 */
export class FtpFs implements RemoteFs {
  private client = new Client(30000)
  private connected = false
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private cfg: FtpConfig) {}

  /** 建立连接并登录（会话首次连接时调用，用于尽早报告认证错误） */
  async open(): Promise<void> {
    await this.run(async () => undefined)
  }

  /** 远程路径 → 线路上的字符串（非 UTF-8 编码时按 latin1 携带原始字节） */
  private w(p: string): string {
    return toWire(p, this.cfg.encoding)
  }
  private u(s: string): string {
    return fromWire(s, this.cfg.encoding)
  }

  /** 非 UTF-8 服务器：手动登录，避免发送 OPTS UTF8 ON 把服务器切到 UTF-8 */
  private async accessLegacy(c: Client): Promise<void> {
    const o = toAccess(this.cfg)
    c.ftp.encoding = 'latin1'
    if (o.secure === 'implicit') await c.connectImplicitTLS(o.host, o.port, o.secureOptions)
    else await c.connect(o.host, o.port)
    if (o.secure === true) await c.useTLS({ ...o.secureOptions, host: o.host })
    await c.login(this.w(o.user ?? 'anonymous'), this.w(o.password ?? ''))
    const features = await c.features()
    if (features.has('MLST')) c.availableListCommands = ['MLSD', 'LIST -a', 'LIST']
    await c.send('TYPE I')
    await c.sendIgnoringError('STRU F')
    if (c.ftp.hasTLS) {
      await c.sendIgnoringError('PBSZ 0')
      await c.sendIgnoringError('PROT P')
    }
  }

  private async ensure(): Promise<Client> {
    if (this.connected && !this.client.closed) return this.client
    if (this.client.closed === false) this.client.close()
    this.client = new Client(30000)
    try {
      if (this.cfg.encoding === 'utf8') await this.client.access(toAccess(this.cfg))
      else await this.accessLegacy(this.client)
    } catch (e) {
      this.client.close()
      throw wrap(e)
    }
    this.connected = true
    return this.client
  }

  /** 串行执行一个 FTP 操作；如果因连接断开失败，重连后重试一次 */
  private run<T>(op: (c: Client) => Promise<T>, retry = true): Promise<T> {
    const task = this.chain.then(async () => {
      let c = await this.ensure()
      try {
        return await op(c)
      } catch (e) {
        const lost = c.closed || /ECONNRESET|EPIPE|421|closed/i.test(String((e as Error)?.message ?? e))
        if (retry && lost && !this.aborted) {
          this.connected = false
          c = await this.ensure()
          return await op(c)
        }
        throw wrap(e)
      } finally {
        this.aborted = false
      }
    })
    this.chain = task.catch(() => undefined)
    return task
  }

  private aborted = false

  private toEntry(dir: string, f: FileInfo): FileEntry {
    const p = f.permissions
    const mode = p ? (p.user << 6) | (p.group << 3) | p.world : 0
    const name = this.u(f.name)
    return {
      name,
      path: path.posix.join(dir, name),
      isDir: f.isDirectory,
      isLink: f.isSymbolicLink,
      size: f.size,
      mtime: f.modifiedAt ? f.modifiedAt.getTime() : 0,
      mode,
      perm: p ? permString(mode, f.isDirectory, f.isSymbolicLink) : f.isDirectory ? 'd' : '-'
    }
  }

  list(dir: string): Promise<FileEntry[]> {
    return this.run(async (c) => {
      const list = await c.list(this.w(dir))
      return list.filter((f) => f.name !== '.' && f.name !== '..').map((f) => this.toEntry(dir, f))
    })
  }

  realpath(p: string): Promise<string> {
    return this.run(async (c) => {
      if (p && p !== '.') await c.cd(this.w(p))
      return this.u(await c.pwd())
    })
  }

  stat(p: string): Promise<RemoteStat> {
    return this.run(async (c) => {
      try {
        await c.cd(this.w(p))
        return { isDir: true, size: 0 }
      } catch {
        return { isDir: false, size: await c.size(this.w(p)) }
      }
    })
  }

  mkdir(p: string): Promise<void> {
    return this.run(async (c) => {
      await c.send('MKD ' + (await c.protectWhitespace(this.w(p))))
    })
  }

  rename(from: string, to: string): Promise<void> {
    return this.run(async (c) => {
      await c.rename(this.w(from), this.w(to))
    })
  }

  remove(p: string): Promise<void> {
    return this.run(async (c) => {
      const wp = this.w(p)
      let isDir = false
      try {
        await c.cd(wp)
        isDir = true
      } catch {
        /* 不是目录 */
      }
      if (isDir) {
        await c.cd('/')
        await c.removeDir(wp)
      } else await c.remove(wp)
    })
  }

  chmod(p: string, mode: number): Promise<void> {
    return this.run(async (c) => {
      try {
        await c.send(`SITE CHMOD ${mode.toString(8)} ${this.w(p)}`)
      } catch (e) {
        throw new Error('该 FTP 服务器不支持修改权限（SITE CHMOD）：' + friendlyError(e))
      }
    })
  }

  /** FTP 协议没有复制命令，只能读出再写入 */
  copy(src: string, dest: string): Promise<void> {
    return copyViaReadWrite(this, src, dest)
  }

  readFile(p: string): Promise<Buffer> {
    return this.run(async (c) => {
      const chunks: Buffer[] = []
      const sink = new Writable({
        write(chunk: Buffer, _enc, cb) {
          chunks.push(chunk)
          cb()
        }
      })
      await c.downloadTo(sink, this.w(p))
      return Buffer.concat(chunks)
    })
  }

  writeFile(p: string, data: Buffer): Promise<void> {
    return this.run(async (c) => {
      await c.uploadFrom(Readable.from([data]), this.w(p))
    }, false)
  }

  upload(localPath: string, remotePath: string, onProgress: (bytes: number) => void): Promise<void> {
    return this.run(async (c) => {
      c.trackProgress((info) => onProgress(info.bytes))
      try {
        await c.uploadFrom(localPath, this.w(remotePath))
      } finally {
        c.trackProgress()
      }
    }, false)
  }

  download(remotePath: string, localPath: string, onProgress: (bytes: number) => void): Promise<void> {
    return this.run(async (c) => {
      c.trackProgress((info) => onProgress(info.bytes))
      try {
        await c.downloadTo(localPath, this.w(remotePath))
      } finally {
        c.trackProgress()
      }
    }, false)
  }

  abort(): void {
    this.aborted = true
    this.connected = false
    this.client.close()
  }

  close(): void {
    this.connected = false
    this.client.close()
  }
}
