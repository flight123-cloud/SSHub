import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  ApiResult,
  AppSettings,
  ConnectRequest,
  ConnectResult,
  Encoding,
  ExternalEditEvent,
  FileEntry,
  TextFile,
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
    disconnect: (id: string) => call<void>('conn:disconnect', id),
    onData: (cb: (id: string, data: Uint8Array | string) => void) => on('ssh:data', cb),
    onClosed: (cb: (id: string) => void) => on('ssh:closed', cb),
    onError: (cb: (id: string, msg: string) => void) => on('ssh:error', cb)
  },

  ftp: {
    connect: (req: ConnectRequest) => call<ConnectResult>('ftp:connect', req),
    disconnect: (id: string) => call<void>('conn:disconnect', id)
  },

  /** 远程文件操作（SFTP / FTP 通用） */
  remote: {
    list: (id: string, dir: string) => call<FileEntry[]>('remote:list', id, dir),
    realpath: (id: string, p: string) => call<string>('remote:realpath', id, p),
    mkdir: (id: string, p: string) => call<void>('remote:mkdir', id, p),
    rename: (id: string, a: string, b: string) => call<void>('remote:rename', id, a, b),
    remove: (id: string, paths: string[]) => call<void>('remote:delete', id, paths),
    chmod: (id: string, p: string, mode: number) => call<void>('remote:chmod', id, p, mode),
    copy: (id: string, src: string, dest: string) => call<void>('remote:copy', id, src, dest),
    openText: (id: string, p: string, encoding?: Encoding) => call<TextFile>('remote:openText', id, p, encoding),
    saveText: (id: string, p: string, text: string, encoding: Encoding, bom: boolean) =>
      call<void>('remote:saveText', id, p, text, encoding, bom),
    /** 下载到临时目录并用系统默认应用打开，保存后自动上传 */
    openExternal: (id: string, p: string) => call<void>('remote:openExternal', id, p),
    onEditEvent: (cb: (e: ExternalEditEvent) => void) => on('edit:event', cb)
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
    createFile: (p: string) => call<void>('local:createFile', p),
    /** 拖入文件的本地绝对路径 */
    pathForFile: (f: File) => webUtils.getPathForFile(f)
  },

  quick: {
    toggle: () => call<void>('quick:toggle'),
    hide: () => call<void>('quick:hide'),
    /** 重新注册全局快捷键，返回错误信息（null 表示成功） */
    hotkeyStatus: () => call<string | null>('quick:hotkeyStatus'),
    isQuick: () => call<boolean>('app:isQuick'),
    onShown: (cb: () => void) => on('quick:shown', cb)
  },

  settings: {
    get: () => call<AppSettings>('settings:get'),
    set: (patch: Partial<AppSettings>) => call<AppSettings>('settings:set', patch),
    reset: () => call<AppSettings>('settings:reset'),
    onChange: (cb: (s: AppSettings) => void) => on('settings:changed', cb)
  },

  ui: {
    pickFile: (title: string) => call<string | null>('dialog:pickFile', title),
    confirm: (message: string, detail?: string) => call<boolean>('dialog:confirm', message, detail),
    /** 弹出保存对话框，写入文本；取消时返回 null */
    saveText: (defaultName: string, content: string) => call<string | null>('dialog:saveText', defaultName, content),
    copyText: (text: string) => call<void>('clipboard:write', text),
    focusWindow: () => call<void>('app:focus'),
    /** Dock 图标弹跳 */
    requestAttention: () => call<void>('app:attention'),
    onMenu: (cb: (cmd: string) => void) => on('menu:command', cb)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
