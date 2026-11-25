import { app, shell } from 'electron'
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ExternalEditEvent } from '../shared/types'
import { get as getConn, onConnectionClosed, send } from './connections'
import { friendlyError } from './errors'

/**
 * 「用本地应用打开」：把远程文件下载到临时目录，用系统默认应用打开，
 * 监视本地文件变化，保存后自动上传回服务器（类似 WinSCP / Xftp 的外部编辑）。
 */
interface Watched {
  key: string
  connId: string
  remotePath: string
  localPath: string
  watcher: fs.FSWatcher
  lastHash: string
  timer?: NodeJS.Timeout
  uploading: boolean
  pending: boolean
}

const watched = new Map<string, Watched>()
const ROOT = (): string => path.join(os.tmpdir(), 'SSHub-edit')

function emit(e: ExternalEditEvent): void {
  send('edit:event', e)
}

function hashFile(p: string): string {
  try {
    return createHash('sha1').update(fs.readFileSync(p)).digest('hex')
  } catch {
    return ''
  }
}

async function sync(w: Watched): Promise<void> {
  if (w.uploading) {
    w.pending = true
    return
  }
  const h = hashFile(w.localPath)
  if (!h || h === w.lastHash) return
  const conn = getConn(w.connId)
  if (!conn || conn.closed) {
    emit({ connId: w.connId, remotePath: w.remotePath, status: 'error', error: '连接已断开，修改未能上传' })
    return
  }
  w.uploading = true
  try {
    await conn.fs.upload(w.localPath, w.remotePath, () => undefined)
    w.lastHash = h
    emit({ connId: w.connId, remotePath: w.remotePath, status: 'synced' })
  } catch (err) {
    emit({ connId: w.connId, remotePath: w.remotePath, status: 'error', error: friendlyError(err) })
  } finally {
    w.uploading = false
    if (w.pending) {
      w.pending = false
      void sync(w)
    }
  }
}

export async function openExternal(connId: string, remotePath: string): Promise<void> {
  const conn = getConn(connId)
  if (!conn || conn.closed) throw new Error('连接已断开')
  const key = connId + '\n' + remotePath
  const existing = watched.get(key)
  if (existing && fs.existsSync(existing.localPath)) {
    // 已经在编辑：直接再打开一次
    const err = await shell.openPath(existing.localPath)
    if (err) throw new Error(err)
    return
  }
  // 每个远程文件一个独立目录，保留原文件名（方便编辑器识别类型）
  const dir = path.join(ROOT(), createHash('sha1').update(key).digest('hex').slice(0, 12))
  fs.mkdirSync(dir, { recursive: true })
  const localPath = path.join(dir, path.posix.basename(remotePath))
  await conn.fs.download(remotePath, localPath, () => undefined)

  const w: Watched = {
    key,
    connId,
    remotePath,
    localPath,
    lastHash: hashFile(localPath),
    uploading: false,
    pending: false,
    // 监视目录而不是文件：很多编辑器保存时会先写临时文件再改名替换
    watcher: fs.watch(dir, (_ev, name) => {
      if (name && name.toString() !== path.basename(localPath)) return
      clearTimeout(w.timer)
      w.timer = setTimeout(() => void sync(w), 500)
    })
  }
  watched.set(key, w)

  const err = await shell.openPath(localPath)
  if (err) throw new Error('无法打开：' + err)
  emit({ connId, remotePath, status: 'opened' })
}

/** 连接断开时停止监视该连接的文件 */
export function stopForConnection(connId: string): void {
  for (const w of [...watched.values()]) {
    if (w.connId !== connId) continue
    clearTimeout(w.timer)
    w.watcher.close()
    watched.delete(w.key)
  }
}

export function stopAll(): void {
  for (const w of watched.values()) {
    clearTimeout(w.timer)
    w.watcher.close()
  }
  watched.clear()
  try {
    fs.rmSync(ROOT(), { recursive: true, force: true })
  } catch {
    /* ignore */
  }
}

app.on('will-quit', stopAll)
onConnectionClosed(stopForConnection)
