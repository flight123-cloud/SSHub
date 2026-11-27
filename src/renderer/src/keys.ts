import { keyLabel, platformKeys, type KeyId } from '../../shared/keymap'

/** 界面上显示快捷键：按当前平台输出「⌘⇧P」或「Ctrl+Shift+P」 */
export const IS_MAC = window.api.platform === 'darwin'
export const IS_WIN = window.api.platform === 'win32'
export const k = (id: KeyId): string => keyLabel(id, IS_MAC)
/** 把写成 macOS 符号的组合键转成当前平台写法（编辑器、文件列表等） */
export const kx = (macDisplay: string): string => platformKeys(macDisplay, IS_MAC)
/** 平台相关的叫法 */
export const FILE_MANAGER = IS_MAC ? 'Finder' : '资源管理器'
export const TRASH = IS_MAC ? '废纸篓' : '回收站'
export const KEYCHAIN = IS_MAC ? 'macOS 钥匙串' : 'Windows 数据保护（DPAPI）'
