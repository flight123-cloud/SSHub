import type { Client, FileEntryWithStats, SFTPWrapper } from 'ssh2'
import path from 'path'
import type { FileEntry } from '../shared/types'
import { friendlyError } from './errors'
import { copyViaReadWrite, permString, type RemoteFs, type RemoteStat } from './remotefs'

const S_IFMT = 0o170000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

function call<T>(fn: (cb: (err: Error | null | undefined, res?: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    fn((err, res) => (err ? reject(new Error(friendlyError(err))) : resolve(res as T)))
  })
}

/** 基于 ssh2 SFTP 子系统的远程文件系统；按需打开通道，通道关闭后自动重开 */
export class SftpFs implements RemoteFs {
  private sftp?: SFTPWrapper
  private pending?: Promise<SFTPWrapper>

  constructor(private client: Client) {}

  private get(): Promise<SFTPWrapper> {
    if (this.sftp) return Promise.resolve(this.sftp)
    if (!this.pending) {
      this.pending = new Promise<SFTPWrapper>((resolve, reject) => {
        this.client.sftp((err, s) => {
          if (err) return reject(new Error('无法打开 SFTP 通道：' + friendlyError(err)))
          s.on('close', () => {
            if (this.sftp === s) this.sftp = undefined
            this.pending = undefined
          })
          this.sftp = s
          resolve(s)
        })
      }).catch((e) => {
        this.pending = undefined
        throw e
      })
    }
    return this.pending
  }

  async list(dir: string): Promise<FileEntry[]> {
    const sftp = await this.get()
    const list = await call<FileEntryWithStats[]>((cb) => sftp.readdir(dir, cb))
    return Promise.all(
      list.map(async (f) => {
        const full = path.posix.join(dir, f.filename)
        const mode = f.attrs.mode ?? 0
        const isLink = (mode & S_IFMT) === S_IFLNK
        let isDir = (mode & S_IFMT) === S_IFDIR
        let size = f.attrs.size ?? 0
        if (isLink) {
          try {
            const st = await call<{ mode: number; size: number }>((cb) => sftp.stat(full, cb))
            isDir = (st.mode & S_IFMT) === S_IFDIR
            size = st.size
          } catch {
            /* 失效的链接 */
          }
        }
        return {
          name: f.filename,
          path: full,
          isDir,
          isLink,
          size,
          mtime: (f.attrs.mtime ?? 0) * 1000,
          mode,
          perm: permString(mode, isDir && !isLink, isLink)
        }
      })
    )
  }

  async realpath(p: string): Promise<string> {
    const sftp = await this.get()
    return call<string>((cb) => sftp.realpath(p, cb))
  }

  async stat(p: string): Promise<RemoteStat> {
    const sftp = await this.get()
    const st = await call<{ mode: number; size: number }>((cb) => sftp.stat(p, cb))
    return { isDir: (st.mode & S_IFMT) === S_IFDIR, size: st.size }
  }

  async mkdir(p: string): Promise<void> {
    const sftp = await this.get()
    await call<void>((cb) => sftp.mkdir(p, cb))
  }

  async rename(from: string, to: string): Promise<void> {
    const sftp = await this.get()
    await call<void>((cb) => sftp.rename(from, to, cb))
  }

  async remove(p: string): Promise<void> {
    const sftp = await this.get()
    const rec = async (q: string): Promise<void> => {
      const st = await call<{ mode: number }>((cb) => sftp.lstat(q, cb))
      if ((st.mode & S_IFMT) === S_IFDIR) {
        const list = await call<FileEntryWithStats[]>((cb) => sftp.readdir(q, cb))
        for (const f of list) await rec(path.posix.join(q, f.filename))
        await call<void>((cb) => sftp.rmdir(q, cb))
      } else {
        await call<void>((cb) => sftp.unlink(q, cb))
      }
    }
    await rec(p)
  }

  async chmod(p: string, mode: number): Promise<void> {
    const sftp = await this.get()
    await call<void>((cb) => sftp.chmod(p, mode, cb))
  }

  /** 优先在服务器上执行 cp -a（快、保留权限）；不能执行命令时退回逐个读写 */
  async copy(src: string, dest: string): Promise<void> {
    const q = (s: string): string => "'" + s.replace(/'/g, "'\\''") + "'"
    const ok = await new Promise<boolean | string>((resolve) => {
      this.client.exec(`cp -a -- ${q(src)} ${q(dest)}`, (err, ch) => {
        if (err) return resolve(false)
        let stderr = ''
        ch.stderr.on('data', (d: Buffer) => (stderr += d.toString()))
        ch.on('data', () => undefined)
        ch.on('close', (code: number | null) => resolve(code === 0 ? true : stderr.trim() || false))
      })
    })
    if (ok === true) return
    if (typeof ok === 'string' && !/not found|No such file or directory.*cp|command not found/i.test(ok)) {
      throw new Error('复制失败：' + ok)
    }
    await copyViaReadWrite(this, src, dest)
  }

  async readFile(p: string): Promise<Buffer> {
    const sftp = await this.get()
    return call<Buffer>((cb) => sftp.readFile(p, cb as never))
  }

  async writeFile(p: string, data: Buffer): Promise<void> {
    const sftp = await this.get()
    await call<void>((cb) => sftp.writeFile(p, data, cb))
  }

  private async xfer(
    dir: 'put' | 'get',
    src: string,
    dest: string,
    onProgress: (bytes: number) => void
  ): Promise<void> {
    const sftp = await this.get()
    await new Promise<void>((resolve, reject) => {
      const opts = {
        concurrency: 64,
        chunkSize: 32768,
        step: (transferred: number): void => onProgress(transferred)
      }
      const cb = (err: Error | null | undefined): void => (err ? reject(err) : resolve())
      // 通道被 abort() 关闭时，fastPut/fastGet 不一定回调，这里兜底
      const onClose = (): void => reject(new Error('已取消'))
      sftp.once('close', onClose)
      const done = (err?: Error | null): void => {
        sftp.removeListener('close', onClose)
        cb(err)
      }
      if (dir === 'put') sftp.fastPut(src, dest, opts, done)
      else sftp.fastGet(src, dest, opts, done)
    })
  }

  upload(localPath: string, remotePath: string, onProgress: (bytes: number) => void): Promise<void> {
    return this.xfer('put', localPath, remotePath, onProgress)
  }

  download(remotePath: string, localPath: string, onProgress: (bytes: number) => void): Promise<void> {
    return this.xfer('get', remotePath, localPath, onProgress)
  }

  abort(): void {
    try {
      this.sftp?.end()
    } catch {
      /* ignore */
    }
    this.sftp = undefined
    this.pending = undefined
  }

  close(): void {
    this.abort()
  }
}
