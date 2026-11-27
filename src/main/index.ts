import { app, BrowserWindow, dialog, ipcMain, Menu, shell, clipboard } from 'electron'
import fs from 'fs'
import path from 'path'
import type { ApiResult, AppSettings, Encoding } from '../shared/types'
import { accelerator, type KeyId } from '../shared/keymap'
import * as ssh from './ssh'
import * as ftp from './ftp'
import * as conns from './connections'
import { friendlyError } from './errors'
import { openExternal } from './externalEdit'
import { applyNativeTheme, getSettings, onSettingsChange, resetSettings, updateSettings } from './settings'
import * as quick from './quick'
import { applyWindowEffects } from './windowEffects'
import { localfs } from './localfs'
import { sessionStore } from './store'

app.setName('SSHub')
// 便于测试时隔离数据目录
if (process.env.SSHUB_USER_DATA) app.setPath('userData', process.env.SSHUB_USER_DATA)

const IS_WIN = process.platform === 'win32'
// Windows：系统通知需要应用 ID（与安装包的 appId 一致）
if (IS_WIN) app.setAppUserModelId('io.github.sshub.app')

// 只允许运行一个实例：再次打开时把已有窗口带到前面
if (!process.env.SSHUB_USER_DATA && !app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: 'SSHub',
    backgroundColor: '#1e1f24',
    // macOS：红黄绿按钮嵌在顶栏里；Windows：隐藏标题栏，系统的最小化/最大化/关闭按钮叠在顶栏右侧
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 14, y: 14 } }
      : IS_WIN
        ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { color: '#24262c', symbolColor: '#d8dae0', height: 40 } }
        : {}),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  applyWindowEffects(win, getSettings())
  win.once('ready-to-show', () => win?.show())

  // 外部链接用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win?.webContents.getURL()) {
      e.preventDefault()
      if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    win = null
    // 主窗口关闭：它的连接已随窗口断开；非 macOS 直接退出（即使 Quick Terminal 还在）
    if (process.platform !== 'darwin') app.quit()
  })
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const k = (id: KeyId): string | undefined => accelerator(id, isMac)
  // 菜单命令发给当前聚焦的窗口（主窗口或 Quick Terminal）
  const sendCmd = (cmd: string) => () => (BrowserWindow.getFocusedWindow() ?? win)?.webContents.send('menu:command', cmd)
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'SSHub',
            submenu: [
              { role: 'about' as const, label: '关于 SSHub' },
              { type: 'separator' as const },
              { label: '设置…', accelerator: k('settings'), registerAccelerator: isMac, click: sendCmd('settings') },
              { type: 'separator' as const },
              { role: 'hide' as const, label: '隐藏 SSHub' },
              { role: 'hideOthers' as const, label: '隐藏其他' },
              { role: 'unhide' as const, label: '全部显示' },
              { type: 'separator' as const },
              { role: 'quit' as const, label: '退出 SSHub' }
            ]
          }
        ]
      : []),
    {
      label: '文件',
      submenu: [
        { label: '新建会话…', accelerator: k('new-session'), registerAccelerator: isMac, click: sendCmd('new-session') },
        { label: '快速连接', accelerator: k('quick-connect'), registerAccelerator: isMac, click: sendCmd('quick-connect') },
        { label: '重新打开关闭的标签页', accelerator: k('reopen-tab'), registerAccelerator: isMac, click: sendCmd('reopen-tab') },
        { label: '搜索会话并连接…', accelerator: k('palette-sessions'), registerAccelerator: isMac, click: sendCmd('palette-sessions') },
        { label: '命令面板…', accelerator: k('palette'), registerAccelerator: isMac, click: sendCmd('palette') },
        { label: '显示 / 隐藏 Quick Terminal', click: () => quick.toggle() },
        { type: 'separator' },
        { label: '关闭分屏 / 标签页', accelerator: k('close-tab'), registerAccelerator: isMac, click: sendCmd('close-tab') },
        ...(isMac
          ? []
          : [
              { type: 'separator' as const },
              { label: '设置…', accelerator: k('settings'), registerAccelerator: isMac, click: sendCmd('settings') },
              { role: 'quit' as const, label: '退出' }
            ])
      ]
    },
    {
      label: '编辑',
      submenu: [
        // Windows / Linux 上 Ctrl+Z/X/C/V/A 留给终端（Ctrl+Z 挂起、Ctrl+C 中断……），输入框会自己处理这些键
        { role: 'undo', label: '撤销', registerAccelerator: isMac },
        { role: 'redo', label: '重做', registerAccelerator: isMac },
        { type: 'separator' },
        { role: 'cut', label: '剪切', registerAccelerator: isMac },
        { role: 'copy', label: '复制', registerAccelerator: isMac },
        { role: 'paste', label: '粘贴', registerAccelerator: isMac },
        { role: 'selectAll', label: '全选', registerAccelerator: isMac },
        ...(isMac
          ? []
          : [
              { type: 'separator' as const },
              { label: '复制（终端）', accelerator: k('term-copy'), registerAccelerator: isMac, click: sendCmd('term-copy') },
              { label: '粘贴（终端）', accelerator: k('term-paste'), registerAccelerator: isMac, click: sendCmd('term-paste') }
            ]),
        { type: 'separator' },
        { label: '查找', accelerator: k('find'), registerAccelerator: isMac, click: sendCmd('find') },
        { label: '清屏', accelerator: k('clear'), registerAccelerator: isMac, click: sendCmd('clear') },
        { label: '将终端输出保存为文件…', accelerator: k('save-output'), registerAccelerator: isMac, click: sendCmd('save-output') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '终端', accelerator: k('view-terminal'), registerAccelerator: isMac, click: sendCmd('view-terminal') },
        { label: '文件传输', accelerator: k('view-files'), registerAccelerator: isMac, click: sendCmd('view-files') },
        { label: '终端 + 文件', accelerator: k('view-split'), registerAccelerator: isMac, click: sendCmd('view-split') },
        { type: 'separator' },
        {
          label: '终端分屏',
          submenu: [
            { label: '向右拆分', accelerator: k('split-right'), registerAccelerator: isMac, click: sendCmd('split-right') },
            { label: '向下拆分', accelerator: k('split-down'), registerAccelerator: isMac, click: sendCmd('split-down') },
            { type: 'separator' },
            { label: '放大 / 还原当前分屏', accelerator: k('zoom-pane'), registerAccelerator: isMac, click: sendCmd('zoom-pane') },
            { label: '均分所有分屏', accelerator: k('equalize-panes'), registerAccelerator: isMac, click: sendCmd('equalize-panes') },
            { type: 'separator' },
            { label: '切换到左侧分屏', accelerator: k('pane-left'), registerAccelerator: isMac, click: sendCmd('pane-left') },
            { label: '切换到右侧分屏', accelerator: k('pane-right'), registerAccelerator: isMac, click: sendCmd('pane-right') },
            { label: '切换到上方分屏', accelerator: k('pane-up'), registerAccelerator: isMac, click: sendCmd('pane-up') },
            { label: '切换到下方分屏', accelerator: k('pane-down'), registerAccelerator: isMac, click: sendCmd('pane-down') },
            { label: '上一个分屏', accelerator: k('pane-prev'), registerAccelerator: isMac, click: sendCmd('pane-prev') },
            { label: '下一个分屏', accelerator: k('pane-next'), registerAccelerator: isMac, click: sendCmd('pane-next') }
          ]
        },
        { type: 'separator' },
        { label: '显示/隐藏会话列表', accelerator: k('toggle-sidebar'), registerAccelerator: isMac, click: sendCmd('toggle-sidebar') },
        { label: '放大字体', accelerator: k('font-bigger'), registerAccelerator: isMac, click: sendCmd('font-bigger') },
        { label: '缩小字体', accelerator: k('font-smaller'), registerAccelerator: isMac, click: sendCmd('font-smaller') },
        { label: '重置字体', accelerator: k('font-reset'), registerAccelerator: isMac, click: sendCmd('font-reset') },
        { type: 'separator' },
        { label: '上一个标签页', accelerator: k('prev-tab'), registerAccelerator: isMac, click: sendCmd('prev-tab') },
        { label: '下一个标签页', accelerator: k('next-tab'), registerAccelerator: isMac, click: sendCmd('next-tab') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '全屏' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const }])
      ]
    },
    {
      role: 'window',
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        ...(isMac ? [{ type: 'separator' as const }, { role: 'front' as const, label: '前置全部窗口' }] : [])
      ]
    },
    {
      role: 'help',
      label: '帮助',
      submenu: [
        { label: '新功能介绍', click: sendCmd('whats-new') },
        { label: '快捷键一览', accelerator: k('shortcuts'), registerAccelerator: isMac, click: sendCmd('shortcuts') },
        { label: '命令面板…', click: sendCmd('palette') },
        { type: 'separator' },
        {
          label: '使用说明（GitHub）',
          click: () => void shell.openExternal('https://github.com/flight123-cloud/SSHub#readme')
        },
        {
          label: '下载最新版本',
          click: () => void shell.openExternal('https://github.com/flight123-cloud/SSHub/releases/latest')
        }
      ]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** 统一包装 IPC：异常转为 { ok:false, error } */
function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, async (_e, ...args: unknown[]): Promise<ApiResult<R>> => {
    try {
      return { ok: true, data: await fn(...(args as A)) }
    } catch (err) {
      return { ok: false, error: friendlyError(err) }
    }
  })
}

/** 需要知道是哪个窗口发起的调用 */
function handleWithSender<R>(channel: string, fn: (sender: Electron.WebContents, ...args: unknown[]) => R | Promise<R>): void {
  ipcMain.handle(channel, async (e, ...args: unknown[]): Promise<ApiResult<R>> => {
    try {
      return { ok: true, data: await fn(e.sender, ...args) }
    } catch (err) {
      return { ok: false, error: friendlyError(err) }
    }
  })
}

function registerIpc(): void {
  // 会话
  handle('session:list', () => sessionStore.list())
  handle('session:save', (input) => sessionStore.save(input as never))
  handle('session:remove', (id: string) => sessionStore.remove(id))
  handle('session:duplicate', (id: string) => sessionStore.duplicate(id))

  // SSH
  handleWithSender('ssh:connect', (sender, req) => ssh.connect(req as never, sender))
  ipcMain.on('ssh:write', (_e, id: string, data: string) => ssh.write(id, data))
  ipcMain.on('ssh:resize', (_e, id: string, cols: number, rows: number) => ssh.resize(id, cols, rows))
  handleWithSender('ftp:connect', (sender, req) => ftp.connect(req as never, sender))
  handle('conn:disconnect', (id: string) => conns.disconnect(id))

  // 远程文件（SFTP / FTP 通用）
  handle('remote:list', (id: string, dir: string) => conns.remote.list(id, dir))
  handle('remote:realpath', (id: string, p: string) => conns.remote.realpath(id, p))
  handle('remote:mkdir', (id: string, p: string) => conns.remote.mkdir(id, p))
  handle('remote:rename', (id: string, a: string, b: string) => conns.remote.rename(id, a, b))
  handle('remote:delete', (id: string, paths: string[]) => conns.remote.remove(id, paths))
  handle('remote:chmod', (id: string, p: string, mode: number) => conns.remote.chmod(id, p, mode))
  handle('remote:copy', (id: string, a: string, b: string) => conns.remote.copy(id, a, b))
  handle('remote:openText', (id: string, p: string, enc?: Encoding) => conns.remote.openText(id, p, enc))
  handle('remote:saveText', (id: string, p: string, text: string, enc: Encoding, bom: boolean) =>
    conns.remote.saveText(id, p, text, enc, bom)
  )
  handle('remote:openExternal', (id: string, p: string) => openExternal(id, p))
  handle('transfer:enqueue', (id: string, dir: 'upload' | 'download', src: string[], dest: string) =>
    conns.enqueueTransfer(id, dir, src, dest)
  )
  handle('transfer:cancel', (tid: string) => conns.cancelTransfer(tid))

  // 本地文件
  handle('local:home', () => localfs.home())
  handle('local:list', (dir: string) => localfs.list(dir))
  handle('local:mkdir', (p: string) => localfs.mkdir(p))
  handle('local:rename', (a: string, b: string) => localfs.rename(a, b))
  handle('local:trash', (paths: string[]) => localfs.trash(paths))
  handle('local:reveal', (p: string) => localfs.reveal(p))
  handle('local:open', (p: string) => localfs.open(p))
  handle('local:createFile', (p: string) => localfs.createFile(p))

  // 杂项
  const parentOf = (sender: Electron.WebContents): BrowserWindow => BrowserWindow.fromWebContents(sender) ?? win!
  handleWithSender('dialog:pickFile', async (sender, title) => {
    const r = await dialog.showOpenDialog(parentOf(sender), {
      title: title as string,
      defaultPath: path.join(localfs.home(), '.ssh'),
      properties: ['openFile', 'showHiddenFiles']
    })
    return r.canceled ? null : r.filePaths[0]
  })
  handleWithSender('dialog:saveText', async (sender, defaultName, content) => {
    const r = await dialog.showSaveDialog(parentOf(sender), {
      title: '保存终端输出',
      defaultPath: path.join(app.getPath('downloads'), defaultName as string),
      filters: [{ name: '文本文件', extensions: ['txt', 'log'] }]
    })
    if (r.canceled || !r.filePath) return null
    await fs.promises.writeFile(r.filePath, content as string, 'utf8')
    return r.filePath
  })
  handleWithSender('dialog:confirm', async (sender, message, detail) => {
    const r = await dialog.showMessageBox(parentOf(sender), {
      type: 'question',
      message: message as string,
      detail: detail as string | undefined,
      buttons: ['取消', '确定'],
      defaultId: 1,
      cancelId: 0
    })
    return r.response === 1
  })
  handle('app:focus', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  handle('app:attention', () => {
    if (process.platform === 'darwin') app.dock?.bounce('informational')
    else win?.flashFrame(true)
  })
  handle('clipboard:write', (text: string) => clipboard.writeText(text))
  handle('quick:toggle', () => quick.toggle())
  handle('quick:hide', () => quick.hide())
  handle('quick:hotkeyStatus', () => quick.applyHotkey())
  handleWithSender('app:isQuick', (sender) => quick.isQuickWindow(sender))
  handle('settings:get', () => getSettings())
  handle('settings:set', (patch: Partial<AppSettings>) => updateSettings(patch))
  handle('settings:reset', () => resetSettings())
  handle('app:openUrl', (url: string) => {
    // 只允许打开项目主页等 https 链接
    if (/^https:\/\/github\.com\/flight123-cloud\/SSHub/i.test(url)) void shell.openExternal(url)
  })
  // Windows 顶栏没有菜单栏：左上角按钮弹出应用菜单
  handleWithSender('app:popupMenu', (sender, x, y) => {
    const w = BrowserWindow.fromWebContents(sender) ?? undefined
    Menu.getApplicationMenu()?.popup({ window: w, x: Math.round(Number(x)), y: Math.round(Number(y)) })
  })
  // 标题栏按钮配色跟随深浅色主题
  handleWithSender('app:titlebarColors', (sender, bg, fg) => {
    const w = BrowserWindow.fromWebContents(sender)
    if (IS_WIN && w && !w.isDestroyed()) w.setTitleBarOverlay({ color: String(bg), symbolColor: String(fg), height: 40 })
  })
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }))
}

app.whenReady().then(() => {
  applyNativeTheme()
  buildMenu()
  registerIpc()
  createWindow()
  quick.initQuickTerminal()
  onSettingsChange((s) => win && applyWindowEffects(win, s))
  app.on('activate', () => {
    // Quick Terminal 窗口不算主窗口
    if (!win) createWindow()
  })
})

app.on('before-quit', () => conns.disconnectAll())

app.on('window-all-closed', () => {
  // macOS 上关闭所有窗口后应用保持在 Dock 中
  if (process.platform !== 'darwin') app.quit()
})
