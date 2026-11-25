import { app, nativeTheme } from 'electron'
import fs from 'fs'
import path from 'path'
import { DEFAULT_SETTINGS, type AppSettings } from '../shared/types'
import { broadcast } from './connections'

const FILE = (): string => path.join(app.getPath('userData'), 'settings.json')

let cache: AppSettings | null = null
const listeners: ((s: AppSettings) => void)[] = []

/** 主进程内部订阅设置变化（全局快捷键、窗口效果等） */
export function onSettingsChange(l: (s: AppSettings) => void): void {
  listeners.push(l)
}

/** 只接受已知字段且类型一致的值，防止坏数据 */
function sanitize(input: Partial<AppSettings>, base: AppSettings): AppSettings {
  const out: AppSettings = { ...base }
  for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof AppSettings)[]) {
    const v = input[k]
    if (v !== undefined && typeof v === typeof DEFAULT_SETTINGS[k]) (out as unknown as Record<string, unknown>)[k] = v
  }
  out.fontSize = Math.min(32, Math.max(9, Math.round(out.fontSize)))
  out.lineHeight = Math.min(2, Math.max(1, out.lineHeight))
  out.scrollback = Math.min(200000, Math.max(500, Math.round(out.scrollback)))
  out.minimumContrast = Math.min(21, Math.max(1, out.minimumContrast))
  out.notifyAfterSeconds = Math.min(3600, Math.max(1, Math.round(out.notifyAfterSeconds)))
  out.undoCloseSeconds = Math.min(600, Math.max(0, Math.round(out.undoCloseSeconds)))
  out.backgroundOpacity = Math.min(1, Math.max(0.3, out.backgroundOpacity))
  out.quickTerminalHeight = Math.min(95, Math.max(20, Math.round(out.quickTerminalHeight)))
  if (!['system', 'dark', 'light'].includes(out.appearance)) out.appearance = 'system'
  return out
}

/** 让系统对话框、菜单、滚动条跟随界面外观 */
export function applyNativeTheme(s: AppSettings = getSettings()): void {
  nativeTheme.themeSource = s.appearance
}

export function getSettings(): AppSettings {
  if (cache) return cache
  try {
    cache = sanitize(JSON.parse(fs.readFileSync(FILE(), 'utf8')), DEFAULT_SETTINGS)
  } catch {
    cache = { ...DEFAULT_SETTINGS }
  }
  return cache
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  cache = sanitize(patch, getSettings())
  fs.mkdirSync(path.dirname(FILE()), { recursive: true })
  fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2))
  applyNativeTheme(cache)
  broadcast('settings:changed', cache)
  listeners.forEach((l) => l(cache!))
  return cache
}

export function resetSettings(): AppSettings {
  cache = { ...DEFAULT_SETTINGS }
  fs.writeFileSync(FILE(), JSON.stringify(cache, null, 2))
  applyNativeTheme(cache)
  broadcast('settings:changed', cache)
  listeners.forEach((l) => l(cache!))
  return cache
}
