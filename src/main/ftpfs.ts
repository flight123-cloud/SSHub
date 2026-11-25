import { Client, type AccessOptions, type FileInfo } from 'basic-ftp'
import path from 'path'
import { Readable, Writable } from 'stream'
import type { FileEntry, FtpSecurity } from '../shared/types'
import { friendlyError } from './errors'
import { permString, type RemoteFs, type RemoteStat } from './remotefs'

export interface FtpConfig {
  host: string
  port: number
  user: string
  password: string
  security: FtpSecurity
  ignoreCert: boolean
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

  private async ensure(): Promise<Client> {
    if (this.connected && !this.client.closed) return this.client
    if (this.client.closed === false) this.client.close()
    this.client = new Client(30000)
    try {
      await this.client.access(toAccess(this.cfg))
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
    return {
      name: f.name,
      path: path.posix.join(dir, f.name),
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
      const list = await c.list(dir)
      return list.filter((f) => f.name !== '.' && f.name !== '..').map((f) => this.toEntry(dir, f))
    })
  }

  realpath(p: string): Promise<string> {
    return this.run(async (c) => {
      if (p && p !== '.') await c.cd(p)
      return c.pwd()
    })
  }

  stat(p: string): Promise<RemoteStat> {
    return this.run(async (c) => {
      try {
        await c.cd(p)
        return { isDir: true, size: 0 }
      } catch {
        return { isDir: false, size: await c.size(p) }
      }
    })
  }

  mkdir(p: string): Promise<void> {
    return this.run(async (c) => {
      await c.send('MKD ' + (await c.protectWhitespace(p)))
    })
  }

  rename(from: string, to: string): Promise<void> {
    return this.run(async (c) => {
      await c.rename(from, to)
    })
  }

  remove(p: string): Promise<void> {
    return this.run(async (c) => {
      let isDir = false
      try {
        await c.cd(p)
        isDir = true
      } catch {
        /* 不是目录 */
      }
      if (isDir) {
        await c.cd('/')
        await c.removeDir(p)
      } else await c.remove(p)
    })
  }

  chmod(p: string, mode: number): Promise<void> {
    return this.run(async (c) => {
      try {
        await c.send(`SITE CHMOD ${mode.toString(8)} ${p}`)
      } catch (e) {
        throw new Error('该 FTP 服务器不支持修改权限（SITE CHMOD）：' + friendlyError(e))
      }
    })
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
      await c.downloadTo(sink, p)
      return Buffer.concat(chunks)
    })
  }

  writeFile(p: string, data: Buffer): Promise<void> {
    return this.run(async (c) => {
      await c.uploadFrom(Readable.from([data]), p)
    }, false)
  }

  upload(localPath: string, remotePath: string, onProgress: (bytes: number) => void): Promise<void> {
    return this.run(async (c) => {
      c.trackProgress((info) => onProgress(info.bytes))
      try {
        await c.uploadFrom(localPath, remotePath)
      } finally {
        c.trackProgress()
      }
    }, false)
  }

  download(remotePath: string, localPath: string, onProgress: (bytes: number) => void): Promise<void> {
    return this.run(async (c) => {
      c.trackProgress((info) => onProgress(info.bytes))
      try {
        await c.downloadTo(localPath, remotePath)
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
