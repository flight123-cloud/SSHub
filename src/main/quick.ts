import { app, BrowserWindow, globalShortcut, screen } from 'electron'
import path from 'path'
import type { AppSettings } from '../shared/types'
import { getSettings, onSettingsChange } from './settings'
import { applyWindowEffects } from './windowEffects'

/**
 * Quick Terminal：按全局快捷键从屏幕顶部滑出的终端窗口（参考 Ghostty）。
 * 隐藏时窗口和连接都保留，下次呼出立即可用。
 */
let quickWin: BrowserWindow | null = null
let registered = ''
let animating = false

function create(): BrowserWindow {
  const w = new BrowserWindow({
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    // macOS：面板窗口，呼出时不会把主窗口一起带到前台
    ...(process.platform === 'darwin' ? { type: 'panel' as const } : {}),
    backgroundColor: '#1e1f24',
    title: 'SSHub Quick Terminal',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  w.setAlwaysOnTop(true, 'floating')
  w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  if (process.env.ELECTRON_RENDERER_URL) void w.loadURL(process.env.ELECTRON_RENDERER_URL + '#quick')
  else void w.loadFile(path.join(__dirname, '../renderer/index.html'), { hash: 'quick' })
  w.on('blur', () => {
    if (getSettings().quickTerminalAutoHide && !animating && w.isVisible() && !w.webContents.isDevToolsFocused()) hide()
  })
  w.on('closed', () => {
    quickWin = null
  })
  applyWindowEffects(w, getSettings())
  return w
}

/** 光标所在屏幕的顶部区域 */
function targetBounds(): Electron.Rectangle {
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const wa = display.workArea
  const h = Math.round((wa.height * getSettings().quickTerminalHeight) / 100)
  return { x: wa.x, y: wa.y, width: wa.width, height: h }
}

/** 从顶部滑入 / 滑出的动画（约 120ms） */
function slide(w: BrowserWindow, from: number, to: number, done?: () => void): void {
  const b = w.getBounds()
  const steps = 8
  let i = 0
  animating = true
  const timer = setInterval(() => {
    i++
    const t = 1 - Math.pow(1 - i / steps, 3) // ease-out
    if (!w.isDestroyed()) w.setBounds({ ...b, y: Math.round(from + (to - from) * t) })
    if (i >= steps) {
      clearInterval(timer)
      animating = false
      done?.()
    }
  }, 15)
}

export function show(): void {
  if (!quickWin || quickWin.isDestroyed()) quickWin = create()
  const w = quickWin
  const b = targetBounds()
  w.setBounds({ ...b, y: b.y - b.height })
  const reveal = (): void => {
    w.show()
    w.focus()
    slide(w, b.y - b.height, b.y)
    w.webContents.send('quick:shown')
  }
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', reveal)
  else reveal()
}

export function hide(): void {
  const w = quickWin
  if (!w || !w.isVisible()) return
  const b = w.getBounds()
  slide(w, b.y, b.y - b.height, () => {
    w.hide()
    // macOS：把焦点还给之前的应用
    if (process.platform === 'darwin' && !BrowserWindow.getAllWindows().some((x) => x !== w && x.isFocused())) app.hide()
  })
}

export function toggle(): void {
  if (quickWin && quickWin.isVisible() && quickWin.isFocused()) hide()
  else show()
}

export function isQuickWindow(wc: Electron.WebContents): boolean {
  return !!quickWin && !quickWin.isDestroyed() && quickWin.webContents === wc
}

/** 按设置注册 / 注销全局快捷键；返回错误信息（快捷键被占用时） */
export function applyHotkey(s: AppSettings = getSettings()): string | null {
  const want = s.quickTerminalEnabled ? s.quickTerminalHotkey : ''
  if (want === registered) return null
  if (registered) globalShortcut.unregister(registered)
  registered = ''
  if (!want) return null
  try {
    if (!globalShortcut.register(want, toggle)) return `快捷键 ${want} 已被其他应用占用`
    registered = want
    return null
  } catch {
    return `快捷键 ${want} 格式不正确`
  }
}

export function initQuickTerminal(): void {
  applyHotkey()
  onSettingsChange((s) => {
    applyHotkey(s)
    if (quickWin) applyWindowEffects(quickWin, s)
  })
  app.on('will-quit', () => globalShortcut.unregisterAll())
}
