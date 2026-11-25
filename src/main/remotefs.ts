import type { FileEntry } from '../shared/types'

export interface RemoteStat {
  isDir: boolean
  size: number
}

/**
 * 远程文件系统抽象：SFTP 与 FTP 各自实现。
 * 所有路径都是远程的绝对 POSIX 路径。
 */
export interface RemoteFs {
  list(dir: string): Promise<FileEntry[]>
  realpath(p: string): Promise<string>
  stat(p: string): Promise<RemoteStat>
  mkdir(p: string): Promise<void>
  rename(from: string, to: string): Promise<void>
  /** 删除文件或（递归）删除目录 */
  remove(p: string): Promise<void>
  /** 不支持时抛出错误 */
  chmod(p: string, mode: number): Promise<void>
  readFile(p: string): Promise<Buffer>
  writeFile(p: string, data: Buffer): Promise<void>
  /** onProgress 回调参数为当前文件已传输字节数 */
  upload(localPath: string, remotePath: string, onProgress: (bytes: number) => void): Promise<void>
  download(remotePath: string, localPath: string, onProgress: (bytes: number) => void): Promise<void>
  /** 中断进行中的传输（之后的操作会自动重建通道） */
  abort(): void
  close(): void
}

export function permString(mode: number, isDir: boolean, isLink = false): string {
  const bits = 'rwxrwxrwx'
  let s = isLink ? 'l' : isDir ? 'd' : '-'
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? bits[i] : '-'
  return s
}
