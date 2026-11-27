import { BrowserWindow, nativeTheme } from 'electron'
import type { AppSettings } from '../shared/types'

/** 窗口半透明 / 毛玻璃：macOS 使用原生 vibrancy，背景色设为透明让效果透出来 */
export function applyWindowEffects(win: BrowserWindow, s: AppSettings): void {
  if (win.isDestroyed()) return
  const translucent = s.backgroundBlur || s.backgroundOpacity < 1
  if (process.platform === 'darwin') {
    win.setVibrancy(s.backgroundBlur ? 'under-window' : null)
  } else if (process.platform === 'win32') {
    // Windows 11 22H2+：亚克力材质；旧系统上调用无效果，不会报错
    try {
      win.setBackgroundMaterial(s.backgroundBlur ? 'acrylic' : 'none')
    } catch {
      /* 不支持时忽略 */
    }
  }
  win.setBackgroundColor(translucent ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#1e1f24' : '#ffffff')
}
