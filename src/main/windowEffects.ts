import { BrowserWindow, nativeTheme } from 'electron'
import type { AppSettings } from '../shared/types'

/** 窗口半透明 / 毛玻璃：macOS 使用原生 vibrancy，背景色设为透明让效果透出来 */
export function applyWindowEffects(win: BrowserWindow, s: AppSettings): void {
  if (win.isDestroyed()) return
  const translucent = s.backgroundBlur || s.backgroundOpacity < 1
  if (process.platform === 'darwin') {
    win.setVibrancy(s.backgroundBlur ? 'under-window' : null)
  }
  win.setBackgroundColor(translucent ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#1e1f24' : '#ffffff')
}
