import { app, BrowserWindow, dialog, ipcMain, Menu, shell, clipboard } from 'electron'
import path from 'path'
import type { ApiResult, Encoding } from '../shared/types'
import * as ssh from './ssh'
import * as ftp from './ftp'
import * as conns from './connections'
import { friendlyError } from './errors'
import { openExternal } from './externalEdit'
import { localfs } from './localfs'
import { sessionStore } from './store'

app.setName('SSHub')
// 便于测试时隔离数据目录
if (process.env.SSHUB_USER_DATA) app.setPath('userData', process.env.SSHUB_USER_DATA)

let win: BrowserWindow | null = null

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 560,
    title: 'SSHub',
    backgroundColor: '#1e1f24',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 14 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  conns.setMainWindow(win)

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
  })
}

function buildMenu(): void {
  const isMac = process.platform === 'darwin'
  const sendCmd = (cmd: string) => () => win?.webContents.send('menu:command', cmd)
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: 'SSHub',
            submenu: [
              { role: 'about' as const, label: '关于 SSHub' },
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
        { label: '新建会话…', accelerator: 'CmdOrCtrl+N', click: sendCmd('new-session') },
        { label: '快速连接', accelerator: 'CmdOrCtrl+K', click: sendCmd('quick-connect') },
        { type: 'separator' },
        { label: '关闭标签页', accelerator: 'CmdOrCtrl+W', click: sendCmd('close-tab') },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const, label: '退出' }])
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' },
        { type: 'separator' },
        { label: '查找', accelerator: 'CmdOrCtrl+F', click: sendCmd('find') },
        { label: '清屏', accelerator: 'CmdOrCtrl+L', click: sendCmd('clear') }
      ]
    },
    {
      label: '视图',
      submenu: [
        { label: '终端', accelerator: 'CmdOrCtrl+1', click: sendCmd('view-terminal') },
        { label: '文件传输', accelerator: 'CmdOrCtrl+2', click: sendCmd('view-files') },
        { label: '分屏', accelerator: 'CmdOrCtrl+3', click: sendCmd('view-split') },
        { type: 'separator' },
        { label: '显示/隐藏会话列表', accelerator: 'CmdOrCtrl+B', click: sendCmd('toggle-sidebar') },
        { label: '放大字体', accelerator: 'CmdOrCtrl+=', click: sendCmd('font-bigger') },
        { label: '缩小字体', accelerator: 'CmdOrCtrl+-', click: sendCmd('font-smaller') },
        { label: '重置字体', accelerator: 'CmdOrCtrl+0', click: sendCmd('font-reset') },
        { type: 'separator' },
        { label: '上一个标签页', accelerator: 'CmdOrCtrl+Shift+[', click: sendCmd('prev-tab') },
        { label: '下一个标签页', accelerator: 'CmdOrCtrl+Shift+]', click: sendCmd('next-tab') },
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

function registerIpc(): void {
  // 会话
  handle('session:list', () => sessionStore.list())
  handle('session:save', (input) => sessionStore.save(input as never))
  handle('session:remove', (id: string) => sessionStore.remove(id))
  handle('session:duplicate', (id: string) => sessionStore.duplicate(id))

  // SSH
  handle('ssh:connect', (req) => ssh.connect(req as never))
  ipcMain.on('ssh:write', (_e, id: string, data: string) => ssh.write(id, data))
  ipcMain.on('ssh:resize', (_e, id: string, cols: number, rows: number) => ssh.resize(id, cols, rows))
  handle('ftp:connect', (req) => ftp.connect(req as never))
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
  handle('dialog:pickFile', async (title: string) => {
    const r = await dialog.showOpenDialog(win!, {
      title,
      defaultPath: path.join(localfs.home(), '.ssh'),
      properties: ['openFile', 'showHiddenFiles']
    })
    return r.canceled ? null : r.filePaths[0]
  })
  handle('dialog:confirm', async (message: string, detail?: string) => {
    const r = await dialog.showMessageBox(win!, {
      type: 'question',
      message,
      detail,
      buttons: ['取消', '确定'],
      defaultId: 1,
      cancelId: 0
    })
    return r.response === 1
  })
  handle('clipboard:write', (text: string) => clipboard.writeText(text))
  handle('app:info', () => ({ version: app.getVersion(), platform: process.platform }))
}

app.whenReady().then(() => {
  buildMenu()
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => conns.disconnectAll())

app.on('window-all-closed', () => {
  // macOS 上关闭窗口时断开所有连接，应用保持在 Dock 中
  conns.disconnectAll()
  if (process.platform !== 'darwin') app.quit()
})
