import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ApiResult,
  ConnectRequest,
  ConnectResult,
  FileEntry,
  SessionInfo,
  SessionInput,
  TransferItem
} from '../shared/types'

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as ApiResult<T>
  if (!r.ok) throw new Error(r.error || '未知错误')
  return r.data as T
}

function on<A extends unknown[]>(channel: string, cb: (...args: A) => void): () => void {
  const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void => cb(...(args as A))
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  platform: process.platform,

  sessions: {
    list: () => call<SessionInfo[]>('session:list'),
    save: (input: SessionInput) => call<SessionInfo>('session:save', input),
    remove: (id: string) => call<void>('session:remove', id),
    duplicate: (id: string) => call<SessionInfo>('session:duplicate', id)
  },

  ssh: {
    connect: (req: ConnectRequest) => call<ConnectResult>('ssh:connect', req),
    write: (id: string, data: string) => ipcRenderer.send('ssh:write', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('ssh:resize', id, cols, rows),
    disconnect: (id: string) => call<void>('ssh:disconnect', id),
    onData: (cb: (id: string, data: Uint8Array) => void) => on('ssh:data', cb),
    onClosed: (cb: (id: string) => void) => on('ssh:closed', cb),
    onError: (cb: (id: string, msg: string) => void) => on('ssh:error', cb)
  },

  sftp: {
    list: (id: string, dir: string) => call<FileEntry[]>('sftp:list', id, dir),
    realpath: (id: string, p: string) => call<string>('sftp:realpath', id, p),
    mkdir: (id: string, p: string) => call<void>('sftp:mkdir', id, p),
    rename: (id: string, a: string, b: string) => call<void>('sftp:rename', id, a, b),
    remove: (id: string, paths: string[]) => call<void>('sftp:delete', id, paths),
    chmod: (id: string, p: string, mode: number) => call<void>('sftp:chmod', id, p, mode),
    readText: (id: string, p: string) => call<string>('sftp:readText', id, p),
    writeText: (id: string, p: string, content: string) => call<void>('sftp:writeText', id, p, content)
  },

  transfer: {
    enqueue: (id: string, direction: 'upload' | 'download', src: string[], dest: string) =>
      call<TransferItem[]>('transfer:enqueue', id, direction, src, dest),
    cancel: (tid: string) => call<void>('transfer:cancel', tid),
    onUpdate: (cb: (t: TransferItem) => void) => on('transfer:update', cb)
  },

  local: {
    home: () => call<string>('local:home'),
    list: (dir: string) => call<FileEntry[]>('local:list', dir),
    mkdir: (p: string) => call<void>('local:mkdir', p),
    rename: (a: string, b: string) => call<void>('local:rename', a, b),
    trash: (paths: string[]) => call<void>('local:trash', paths),
    reveal: (p: string) => call<void>('local:reveal', p),
    open: (p: string) => call<void>('local:open', p),
    /** 拖入文件的本地绝对路径 */
    pathForFile: (f: File) => webUtils.getPathForFile(f)
  },

  ui: {
    pickFile: (title: string) => call<string | null>('dialog:pickFile', title),
    confirm: (message: string, detail?: string) => call<boolean>('dialog:confirm', message, detail),
    copyText: (text: string) => call<void>('clipboard:write', text),
    onMenu: (cb: (cmd: string) => void) => on('menu:command', cb)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
