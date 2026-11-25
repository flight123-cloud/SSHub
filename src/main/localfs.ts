import { shell } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { FileEntry } from '../shared/types'

function permString(mode: number, isDir: boolean): string {
  const bits = 'rwxrwxrwx'
  let s = isDir ? 'd' : '-'
  for (let i = 0; i < 9; i++) s += mode & (1 << (8 - i)) ? bits[i] : '-'
  return s
}

export const localfs = {
  home(): string {
    return os.homedir()
  },

  async list(dir: string): Promise<FileEntry[]> {
    const names = await fs.promises.readdir(dir)
    const out: FileEntry[] = []
    await Promise.all(
      names.map(async (name) => {
        const full = path.join(dir, name)
        try {
          const lst = await fs.promises.lstat(full)
          let st = lst
          if (lst.isSymbolicLink()) st = await fs.promises.stat(full).catch(() => lst)
          out.push({
            name,
            path: full,
            isDir: st.isDirectory(),
            isLink: lst.isSymbolicLink(),
            size: st.size,
            mtime: st.mtimeMs,
            mode: st.mode,
            perm: permString(st.mode, st.isDirectory())
          })
        } catch {
          /* 无权限访问的条目跳过 */
        }
      })
    )
    return out
  },

  async mkdir(p: string): Promise<void> {
    await fs.promises.mkdir(p)
  },

  /** 新建空文件（已存在时报错，不覆盖） */
  async createFile(p: string): Promise<void> {
    await fs.promises.writeFile(p, '', { flag: 'wx' })
  },

  async rename(from: string, to: string): Promise<void> {
    await fs.promises.rename(from, to)
  },

  /** 移到废纸篓，比直接删除更安全 */
  async trash(paths: string[]): Promise<void> {
    for (const p of paths) await shell.trashItem(p)
  },

  reveal(p: string): void {
    shell.showItemInFolder(p)
  },

  async open(p: string): Promise<void> {
    const err = await shell.openPath(p)
    if (err) throw new Error(err)
  },

  parent(p: string): string {
    return path.dirname(p)
  },

  join(...parts: string[]): string {
    return path.join(...parts)
  }
}
