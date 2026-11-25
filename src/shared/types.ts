export type AuthType = 'password' | 'key' | 'agent'

/** ssh：SSH 终端 + SFTP 文件传输；ftp：仅文件传输（FTP / FTPS） */
export type Protocol = 'ssh' | 'ftp'

/** FTP 加密方式：none 明文 FTP；explicit 显式 FTPS（AUTH TLS）；implicit 隐式 FTPS（通常 990 端口） */
export type FtpSecurity = 'none' | 'explicit' | 'implicit'

/** 服务器字符编码：影响终端显示、FTP 文件名和在线编辑的文件内容 */
export type Encoding = 'utf8' | 'gbk' | 'big5'

export const ENCODING_LABELS: Record<Encoding, string> = {
  utf8: 'UTF-8',
  gbk: 'GBK / GB18030（简体中文）',
  big5: 'Big5（繁体中文）'
}

export interface FtpOptions {
  security: FtpSecurity
  /** 跳过 TLS 证书校验（自签名证书时使用） */
  ignoreCert: boolean
  /** 匿名登录 */
  anonymous: boolean
}

/** 会话配置（渲染进程可见，不含明文密码） */
export interface SessionInfo {
  id: string
  protocol: Protocol
  ftp?: FtpOptions
  /** 默认 utf8 */
  encoding?: Encoding
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
  protocol: Protocol
  ftp?: FtpOptions
  /** 默认 utf8 */
  encoding?: Encoding
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
  quick?: QuickTarget
  /** 连接时临时输入的密码（会话未保存密码时） */
  password?: string
  cols: number
  rows: number
}

export interface QuickTarget {
  protocol: Protocol
  ftp?: FtpOptions
  encoding?: Encoding
  host: string
  port: number
  username: string
  password?: string
}

export interface ConnectResult {
  connId: string
  protocol: Protocol
  encoding: Encoding
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

/** 在线编辑：打开的文本文件 */
export interface TextFile {
  text: string
  /** 实际使用的编码 */
  encoding: Encoding
  /** 是否带 UTF-8 BOM */
  bom: boolean
  /** 换行符 */
  eol: 'lf' | 'crlf'
  size: number
}

/** 用本地应用打开的远程文件，保存后自动上传的结果 */
export interface ExternalEditEvent {
  connId: string
  remotePath: string
  status: 'opened' | 'synced' | 'error'
  error?: string
}

/** 应用设置（保存在 ~/Library/Application Support/SSHub/settings.json） */
export interface AppSettings {
  // 主题
  /** 界面外观：跟随系统 / 深色 / 浅色 */
  appearance: 'system' | 'dark' | 'light'
  /** 深色模式下使用的终端配色 */
  terminalThemeDark: string
  /** 浅色模式下使用的终端配色 */
  terminalThemeLight: string
  /** 终端背景不透明度（0.3 - 1） */
  backgroundOpacity: number
  /** 窗口毛玻璃效果（macOS） */
  backgroundBlur: boolean
  // 终端外观
  fontFamily: string
  fontSize: number
  lineHeight: number
  cursorStyle: 'block' | 'bar' | 'underline'
  cursorBlink: boolean
  scrollback: number
  /** GPU（WebGL）渲染 */
  gpuRendering: boolean
  /** 最低对比度（1 = 不调整，WCAG 对比度 1-21） */
  minimumContrast: number
  /** 连字（如 => 显示为箭头，需要使用支持连字的字体） */
  fontLigatures: boolean
  /** 在终端中显示图片（Sixel / iTerm2 图片协议） */
  terminalImages: boolean
  // 终端行为
  copyOnSelect: boolean
  /** 粘贴多行内容前确认（远程程序开启了括号粘贴模式时不提示） */
  pasteProtection: boolean
  /** 允许服务器上的程序通过 OSC 52 写入本机剪贴板 */
  osc52Write: boolean
  /** Option 键作为 Alt/Meta 使用 */
  optionAsAlt: boolean
  /** 终端里右键：弹出菜单 / 直接粘贴 */
  rightClick: 'menu' | 'paste'
  /** 调整大小时显示行列数 */
  resizeOverlay: boolean
  /** 分屏时让未聚焦的面板变暗 */
  dimUnfocusedSplits: boolean
  // 通知
  /** 长命令完成通知：从不 / 窗口或标签页不在前台时 / 总是 */
  notifyOnCommandFinish: 'never' | 'unfocused' | 'always'
  /** 命令运行超过多少秒才通知 */
  notifyAfterSeconds: number
  /** 终端响铃（\a）时通知并在标签页上标记 */
  bellNotify: boolean
  // Quick Terminal
  quickTerminalEnabled: boolean
  /** 全局快捷键（Electron accelerator 格式） */
  quickTerminalHotkey: string
  /** 呼出时连接的会话 ID（空 = 每次让用户选择） */
  quickTerminalSessionId: string
  /** 高度占屏幕的百分比 */
  quickTerminalHeight: number
  /** 失去焦点时自动隐藏 */
  quickTerminalAutoHide: boolean
  // 连接与文件
  /** 关闭标签页后可撤销的秒数（0 = 不可撤销） */
  undoCloseSeconds: number
  confirmCloseConnected: boolean
  /** 已看过「新功能导览」的版本号（升级后自动再弹出） */
  lastSeenVersion: string
  /** 双击远程文本文件：编辑 / 下载 */
  doubleClickText: 'edit' | 'download'
  showHiddenFiles: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  appearance: 'system',
  terminalThemeDark: 'sshub-dark',
  terminalThemeLight: 'sshub-light',
  backgroundOpacity: 1,
  backgroundBlur: false,
  fontFamily: '"SF Mono", Menlo, Monaco, "PingFang SC", "Courier New", monospace',
  fontSize: 14,
  lineHeight: 1.15,
  cursorStyle: 'block',
  cursorBlink: true,
  scrollback: 10000,
  gpuRendering: true,
  minimumContrast: 1,
  fontLigatures: false,
  terminalImages: true,
  copyOnSelect: false,
  pasteProtection: true,
  osc52Write: true,
  optionAsAlt: false,
  rightClick: 'menu',
  resizeOverlay: true,
  dimUnfocusedSplits: true,
  notifyOnCommandFinish: 'unfocused',
  notifyAfterSeconds: 10,
  bellNotify: true,
  undoCloseSeconds: 10,
  quickTerminalEnabled: false,
  quickTerminalHotkey: 'Control+`',
  quickTerminalSessionId: '',
  quickTerminalHeight: 45,
  quickTerminalAutoHide: true,
  confirmCloseConnected: true,
  lastSeenVersion: '',
  doubleClickText: 'edit',
  showHiddenFiles: false
}
