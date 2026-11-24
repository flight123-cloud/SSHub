export type AuthType = 'password' | 'key' | 'agent'

/** 会话配置（渲染进程可见，不含明文密码） */
export interface SessionInfo {
  id: string
  name: string
  group: string
  host: string
  port: number
  username: string
  authType: AuthType
  privateKeyPath?: string
  /** 是否已保存密码 / 私钥口令 */
  hasPassword: boolean
  hasPassphrase: boolean
  createdAt: number
  lastUsedAt?: number
}

/** 保存会话时由渲染进程提交的数据 */
export interface SessionInput {
  id?: string
  name: string
  group: string
  host: string
  port: number
  username: string
  authType: AuthType
  privateKeyPath?: string
  /** undefined = 保持原值；'' = 清除 */
  password?: string
  passphrase?: string
}

/** 连接参数：要么引用已保存会话，要么临时（快速连接） */
export interface ConnectRequest {
  sessionId?: string
  quick?: {
    host: string
    port: number
    username: string
    password?: string
  }
  /** 连接时临时输入的密码（会话未保存密码时） */
  password?: string
  cols: number
  rows: number
}

export interface ConnectResult {
  connId: string
  title: string
  homeDir: string
}

export interface FileEntry {
  name: string
  path: string
  isDir: boolean
  isLink: boolean
  size: number
  mtime: number
  mode: number
  /** 如 drwxr-xr-x */
  perm: string
}

export type TransferDirection = 'upload' | 'download'
export type TransferStatus = 'queued' | 'running' | 'done' | 'error' | 'canceled'

export interface TransferItem {
  id: string
  connId: string
  direction: TransferDirection
  name: string
  src: string
  dest: string
  total: number
  transferred: number
  status: TransferStatus
  error?: string
  startedAt?: number
  finishedAt?: number
  speed?: number
}

export interface ApiResult<T> {
  ok: boolean
  data?: T
  error?: string
}
