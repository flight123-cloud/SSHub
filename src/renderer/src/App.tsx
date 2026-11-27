import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectRequest, ConnectResult, Protocol, QuickTarget, SessionInfo } from '../../shared/types'
import { emitCommand, startBus } from './bus'
import { Sidebar } from './components/Sidebar'
import { SessionDialog } from './components/SessionDialog'
import { PromptDialog, type PromptOptions } from './components/Modal'
import { TerminalView, type AttentionKind, type ConnStatus } from './components/TerminalView'
import { SplitView } from './components/SplitView'
import { equalize, leaf, leaves, neighbor, newPaneId, removePane, setRatio, splitPane, type PaneNode } from './panes'
import { FilesView } from './components/FilesView'
import { FtpView } from './components/FtpView'
import { SettingsDialog, type SettingsTab } from './components/SettingsDialog'
import { ShortcutsDialog, WhatsNew } from './components/WhatsNew'
import { ContextMenu, type MenuItem } from './components/ContextMenu'
import { IconCommand, IconGear, IconHelp, IconMore, IconSearch, IconSparkle, IconSplitDown, IconSplitRight, IconZoom, IconBolt } from './components/Icons'
import { CommandPalette, type PaletteItem } from './components/CommandPalette'
import { getSettings, updateSettings, useIsDark, useSettings } from './settings'
import { useTerminalTheme } from './themes'
import { IS_MAC, IS_WIN, k } from './keys'
import { onAppCommand } from './keybindings'
import { errMsg, parseQuick, uid } from './util'

type View = 'terminal' | 'files' | 'split'

interface Tab {
  key: string
  title: string
  protocol: Protocol
  sessionId?: string
  quick?: QuickTarget
  status: ConnStatus
  conn?: ConnectResult
  error?: string
  view: View
  // ---- 分屏（仅 SSH）----
  tree: PaneNode
  /** 面板创建顺序 */
  order: string[]
  focusedPane: string
  /** 文件传输使用这个面板的连接；标签页的状态也取自它 */
  primaryPane: string
  zoomed: string | null
  panes: Record<string, { status: ConnStatus; conn?: ConnectResult; error?: string }>
  /** 已关闭、等待撤销 */
  closedAt?: number
  /** 后台有提醒（响铃 / 命令完成） */
  attention?: boolean
}

interface Toast {
  id: string
  msg: string
  error?: boolean
  action?: { label: string; run: () => void }
}

function loadNum(key: string, def: number): number {
  try {
    const v = Number(localStorage.getItem(key))
    return Number.isFinite(v) && v > 0 ? v : def
  } catch {
    return def
  }
}
function saveNum(key: string, v: number): void {
  try {
    localStorage.setItem(key, String(v))
  } catch {
    /* ignore */
  }
}

startBus()

export default function App() {
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ session?: SessionInfo } | null>(null)
  const [prompt, setPrompt] = useState<{ opts: PromptOptions; resolve: (v: string | null, c: boolean) => void } | null>(null)
  const settings = useSettings()
  const isDark = useIsDark()
  const termTheme = useTerminalTheme(settings, isDark)
  // Windows：标题栏右侧的系统按钮跟随深浅色
  useEffect(() => {
    if (!IS_WIN) return
    const css = getComputedStyle(document.documentElement)
    void window.api.app.titlebarColors(css.getPropertyValue('--bg-2').trim() || '#24262c', css.getPropertyValue('--text').trim() || '#d8dae0')
  }, [isDark])
  const [settingsOpen, setSettingsOpen] = useState<SettingsTab | null>(null)
  const [whatsNew, setWhatsNew] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [version, setVersion] = useState('')
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  // 升级后第一次打开时自动显示新功能导览
  useEffect(() => {
    void window.api.app.info().then((info) => {
      setVersion(info.version)
      if (getSettings().lastSeenVersion !== info.version) setWhatsNew(true)
    })
  }, [])
  const closeWhatsNew = (): void => {
    setWhatsNew(false)
    if (version) updateSettings({ lastSeenVersion: version })
  }
  const [palette, setPalette] = useState<'sessions' | 'all' | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => loadNum('sidebarWidth', 250))
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [toasts, setToasts] = useState<Toast[]>([])
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  const activeRef = useRef(activeKey)
  activeRef.current = activeKey

  const notify = useCallback((msg: string, error = false, action?: Toast['action'], ms?: number): string => {
    const id = uid()
    setToasts((t) => [...t, { id, msg, error, action }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), ms ?? (error ? 6000 : 3000))
    return id
  }, [])
  const dismissToast = (id: string): void => setToasts((t) => t.filter((x) => x.id !== id))

  const reload = useCallback(async () => {
    try {
      setSessions(await window.api.sessions.list())
    } catch (e) {
      notify(errMsg(e), true)
    }
  }, [notify])

  useEffect(() => {
    void reload()
  }, [reload])

  const ask = (opts: PromptOptions): Promise<{ value: string | null; checked: boolean }> =>
    new Promise((resolve) => setPrompt({ opts, resolve: (value, checked) => resolve({ value, checked }) }))

  const updateTab = (key: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)): void =>
    setTabs((list) => list.map((t) => (t.key === key ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)))

  /** 标签页中可见（未关闭）的列表 */
  const visibleTabs = tabs.filter((t) => !t.closedAt)

  const openTab = (tab: Pick<Tab, 'title' | 'protocol' | 'sessionId' | 'quick'>): void => {
    const key = uid()
    const first = newPaneId()
    setTabs((list) => [
      ...list,
      {
        ...tab,
        key,
        status: 'connecting',
        view: tab.protocol === 'ftp' ? 'files' : 'terminal',
        tree: leaf(first),
        order: [first],
        focusedPane: first,
        primaryPane: first,
        zoomed: null,
        panes: { [first]: { status: 'connecting' } }
      }
    ])
    setActiveKey(key)
  }

  /** 面板连接状态变化；主面板的状态同步到标签页 */
  const onPaneStatus = (key: string, pane: string, status: ConnStatus, conn?: ConnectResult, error?: string): void =>
    updateTab(key, (t) => {
      const prev = t.panes[pane]
      const info = { status, conn: conn ?? (status === 'connected' ? prev?.conn : prev?.conn), error }
      const panes = { ...t.panes, [pane]: info }
      return pane === t.primaryPane ? { panes, status, conn: info.conn, error } : { panes }
    })

  /* ---------- 分屏操作 ---------- */
  const splitFocused = (dir: 'row' | 'col'): void => {
    const t = tabsRef.current.find((x) => x.key === activeRef.current)
    if (!t || t.protocol !== 'ssh') return
    const id = newPaneId()
    updateTab(t.key, (x) => ({
      tree: splitPane(x.tree, x.focusedPane, dir, id),
      order: [...x.order, id],
      focusedPane: id,
      zoomed: null,
      view: x.view === 'files' ? 'terminal' : x.view,
      panes: { ...x.panes, [id]: { status: 'connecting' } }
    }))
  }

  const closePane = async (key: string, pane: string): Promise<void> => {
    const t = tabsRef.current.find((x) => x.key === key)
    if (!t) return
    const rest = removePane(t.tree, pane)
    if (!rest) return closeTab(key)
    if (
      t.panes[pane]?.status === 'connected' &&
      getSettings().confirmCloseConnected &&
      !(await window.api.ui.confirm('断开并关闭这个分屏？'))
    )
      return
    updateTab(key, (x) => {
      const remaining = leaves(rest)
      const focusedPane = x.focusedPane === pane ? (neighbor(x.tree, pane, 'left') ?? neighbor(x.tree, pane, 'up') ?? remaining[0]) : x.focusedPane
      const primaryPane = x.primaryPane === pane ? remaining[0] : x.primaryPane
      const panes = { ...x.panes }
      delete panes[pane]
      const p = panes[primaryPane]
      return {
        tree: rest,
        order: x.order.filter((o) => o !== pane),
        focusedPane: remaining.includes(focusedPane) ? focusedPane : remaining[0],
        primaryPane,
        zoomed: null,
        panes,
        status: p?.status ?? x.status,
        conn: p?.conn,
        error: p?.error
      }
    })
  }

  const focusPane = (dir: 'left' | 'right' | 'up' | 'down' | 'next' | 'prev'): void => {
    const t = tabsRef.current.find((x) => x.key === activeRef.current)
    if (!t || t.protocol !== 'ssh') return
    let target: string | null
    if (dir === 'next' || dir === 'prev') {
      const ls = leaves(t.tree)
      const i = ls.indexOf(t.focusedPane)
      target = ls[(i + (dir === 'next' ? 1 : -1) + ls.length) % ls.length]
    } else target = neighbor(t.tree, t.focusedPane, dir)
    if (target) updateTab(t.key, { focusedPane: target, zoomed: t.zoomed ? target : null })
  }

  /* ---------- 提醒：系统通知 / Dock 弹跳 / 标签页标记 ---------- */
  const onAttention = (key: string, pane: string, kind: AttentionKind, message: string): void => {
    const t = tabsRef.current.find((x) => x.key === key)
    if (!t || t.closedAt) return
    const windowFocused = document.hasFocus()
    const inFront = windowFocused && activeRef.current === key && t.view !== 'files' && (t.zoomed === null || t.zoomed === pane)
    const st = getSettings()
    if (kind !== 'bell' && st.notifyOnCommandFinish === 'never' && kind === 'command') return
    const must = kind !== 'bell' && st.notifyOnCommandFinish === 'always'
    if (inFront && !must) return
    if (activeRef.current !== key) updateTab(key, { attention: true })
    const goto = (): void => {
      void window.api.ui.focusWindow()
      setActiveKey(key)
      updateTab(key, { attention: false, focusedPane: pane })
    }
    if (windowFocused) {
      // 窗口在前台时，响铃只在标签页上做标记，不弹提示
      if (kind === 'bell') return
      if (activeRef.current !== key || must) notify(`${t.title}：${message}`, false, { label: '查看', run: goto }, 6000)
      return
    }
    void window.api.ui.requestAttention()
    try {
      const n = new Notification(t.title, { body: kind === 'bell' ? '终端响铃' : message, silent: kind === 'bell' })
      n.onclick = goto
    } catch {
      /* 通知不可用时忽略 */
    }
  }

  const connectSession = (s: SessionInfo): void => openTab({ title: s.name, sessionId: s.id, protocol: s.protocol })

  const quickConnect = async (text: string): Promise<void> => {
    const q = parseQuick(text)
    if (!q) {
      notify('格式不正确。示例：root@1.2.3.4、user@host:2222、ftp://user@host', true)
      return
    }
    const isFtp = q.protocol === 'ftp'
    const anonymous = isFtp && q.ftp?.anonymous
    const kind = isFtp ? (q.ftp?.security === 'none' ? 'FTP' : 'FTPS') : 'SSH'
    const r = await ask({
      title: `${kind} 连接 ${q.username}@${q.host}:${q.port}`,
      label: anonymous
        ? '匿名登录，密码可留空'
        : isFtp
          ? '密码'
          : '密码（留空则使用本机 SSH 密钥 / Agent）',
      password: true,
      defaultValue: q.password,
      checkbox: '保存到左侧会话列表（下次双击即可连接）',
      okText: '连接'
    })
    if (r.value === null) return
    const password = r.value || undefined
    if (r.checked) {
      try {
        const saved = await window.api.sessions.save({
          protocol: q.protocol,
          ftp: q.ftp,
          name: `${q.username}@${q.host}`,
          group: '',
          host: q.host,
          port: q.port,
          username: q.username,
          authType: isFtp || password ? 'password' : 'agent',
          password
        })
        await reload()
        notify(`已保存会话「${saved.name}」`)
        connectSessionWith(saved)
        return
      } catch (e) {
        notify(errMsg(e), true)
      }
    }
    openTab({ title: `${q.username}@${q.host}`, protocol: q.protocol, quick: { ...q, password } })
  }

  /** 刚保存的会话：sessionsRef 可能尚未刷新，先放进去 */
  const connectSessionWith = (s: SessionInfo): void => {
    if (!sessionsRef.current.some((x) => x.id === s.id)) sessionsRef.current = [...sessionsRef.current, s]
    connectSession(s)
  }

  /** 每次连接前准备参数：必要时询问密码 */
  const makePrepare =
    (tabKey: string) =>
    async (retryAuth: boolean): Promise<Omit<ConnectRequest, 'cols' | 'rows'> | null> => {
      const tab = tabsRef.current.find((t) => t.key === tabKey)
      if (!tab) return null
      if (tab.quick) {
        if (retryAuth) {
          const r = await ask({
            title: `连接 ${tab.quick.username}@${tab.quick.host}`,
            label: '认证失败，请重新输入密码',
            password: true,
            okText: '连接'
          })
          if (r.value === null) return null
          tab.quick.password = r.value || undefined
        }
        return { quick: tab.quick }
      }
      const s = sessionsRef.current.find((x) => x.id === tab.sessionId)
      if (!s) {
        notify('会话已被删除', true)
        return null
      }
      const needsPassword = s.protocol === 'ftp' ? !s.ftp?.anonymous : s.authType === 'password'
      if (needsPassword && (!s.hasPassword || retryAuth)) {
        const r = await ask({
          title: `连接 ${s.name}`,
          label: retryAuth ? `认证失败，请重新输入 ${s.username}@${s.host} 的密码` : `${s.username}@${s.host} 的密码`,
          password: true,
          checkbox: '记住密码',
          okText: '连接'
        })
        if (r.value === null) return null
        if (r.checked) {
          await window.api.sessions.save({ ...s, password: r.value })
          void reload()
        }
        return { sessionId: s.id, password: r.value }
      }
      return { sessionId: s.id }
    }

  const prepares = useRef(new Map<string, ReturnType<typeof makePrepare>>())
  const getPrepare = (key: string): ReturnType<typeof makePrepare> => {
    if (!prepares.current.has(key)) prepares.current.set(key, makePrepare(key))
    return prepares.current.get(key)!
  }

  const undoTimers = useRef(new Map<string, { timer: number; toast: string }>())

  /** 彻底移除标签页（卸载组件、断开连接） */
  const removeTab = (key: string): void => {
    prepares.current.delete(key)
    undoTimers.current.delete(key)
    setTabs((list) => list.filter((t) => t.key !== key))
  }

  const closeTab = async (key: string): Promise<void> => {
    const tab = tabsRef.current.find((t) => t.key === key)
    if (!tab || tab.closedAt) return
    const st = getSettings()
    const anyConnected = Object.values(tab.panes).some((p) => p.status === 'connected') || tab.status === 'connected'
    if (anyConnected && st.confirmCloseConnected && !(await window.api.ui.confirm(`断开并关闭「${tab.title}」？`))) return
    // 切换到相邻的标签页
    if (activeRef.current === key) {
      const vis = tabsRef.current.filter((t) => !t.closedAt)
      const idx = vis.findIndex((t) => t.key === key)
      const rest = vis.filter((t) => t.key !== key)
      setActiveKey(rest[Math.min(idx, rest.length - 1)]?.key ?? null)
    }
    if (st.undoCloseSeconds <= 0) return removeTab(key)
    // 先隐藏，连接保持；超时后才真正关闭
    updateTab(key, { closedAt: Date.now() })
    const toast = notify(`已关闭「${tab.title}」`, false, { label: `撤销 ${IS_MAC ? '⌘Z' : k('reopen-tab')}`, run: () => reopenTab(key) }, st.undoCloseSeconds * 1000)
    const timer = window.setTimeout(() => removeTab(key), st.undoCloseSeconds * 1000)
    undoTimers.current.set(key, { timer, toast })
  }

  /** 恢复最近关闭的标签页（或指定的那个） */
  const reopenTab = (key?: string): boolean => {
    const closed = tabsRef.current.filter((t) => t.closedAt).sort((a, b) => b.closedAt! - a.closedAt!)
    const t = key ? closed.find((x) => x.key === key) : closed[0]
    if (!t) return false
    const u = undoTimers.current.get(t.key)
    if (u) {
      window.clearTimeout(u.timer)
      dismissToast(u.toast)
      undoTimers.current.delete(t.key)
    }
    updateTab(t.key, { closedAt: undefined })
    setActiveKey(t.key)
    return true
  }

  // ⌘Z：焦点在终端（而不是输入框 / 编辑器）时撤销关闭标签页
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // 只在 macOS 上用 ⌘Z；Windows / Linux 的 Ctrl+Z 在终端里是挂起程序，必须交给终端
      if (!IS_MAC || !e.metaKey || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return
      const el = document.activeElement as HTMLElement | null
      const inTerminal = !el || el === document.body || el.classList.contains('xterm-helper-textarea')
      if (!inTerminal || !tabsRef.current.some((t) => t.closedAt)) return
      e.preventDefault()
      e.stopPropagation()
      reopenTab()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 切换到有提醒标记的标签页时清除标记
  useEffect(() => {
    const t = tabs.find((x) => x.key === activeKey)
    if (t?.attention) updateTab(t.key, { attention: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey])

  const deleteSession = async (s: SessionInfo): Promise<void> => {
    if (!(await window.api.ui.confirm(`删除会话「${s.name}」？`))) return
    await window.api.sessions.remove(s.id)
    void reload()
  }

  // 菜单命令
  useEffect(
    () =>
      onAppCommand((cmd) => {
        const active = tabsRef.current.find((t) => t.key === activeRef.current)
        switch (cmd) {
          case 'new-session':
            setEditing({})
            break
          case 'quick-connect':
            focusQuickConnect()
            break
          case 'close-tab':
            // 打开了编辑器时，⌘W 只关闭编辑器；有分屏时先关闭当前分屏
            if (document.querySelector('.modal.editor')) emitCommand('close-editor')
            else if (active && active.protocol === 'ssh' && active.view !== 'files' && leaves(active.tree).length > 1)
              void closePane(active.key, active.focusedPane)
            else if (active) void closeTab(active.key)
            break
          case 'reopen-tab':
            if (!reopenTab()) notify('没有可以恢复的标签页')
            break
          case 'split-right':
            splitFocused('row')
            break
          case 'split-down':
            splitFocused('col')
            break
          case 'zoom-pane':
            if (active && leaves(active.tree).length > 1)
              updateTab(active.key, (x) => ({ zoomed: x.zoomed ? null : x.focusedPane }))
            break
          case 'equalize-panes':
            if (active) updateTab(active.key, (x) => ({ tree: equalize(x.tree) }))
            break
          case 'pane-left':
          case 'pane-right':
          case 'pane-up':
          case 'pane-down':
          case 'pane-next':
          case 'pane-prev':
            focusPane(cmd.slice(5) as 'left')
            break
          case 'view-terminal':
          case 'view-files':
          case 'view-split':
            if (active) updateTab(active.key, { view: cmd.slice(5) as View })
            break
          case 'toggle-sidebar':
            setSidebarOpen((v) => !v)
            break
          case 'font-bigger':
            updateSettings({ fontSize: Math.min(32, getSettings().fontSize + 1) })
            break
          case 'font-smaller':
            updateSettings({ fontSize: Math.max(9, getSettings().fontSize - 1) })
            break
          case 'font-reset':
            updateSettings({ fontSize: 14 })
            break
          case 'settings':
            setSettingsOpen('appearance')
            break
          case 'whats-new':
            setWhatsNew(true)
            break
          case 'shortcuts':
            setShortcutsOpen(true)
            break
          case 'palette':
            setPalette('all')
            break
          case 'palette-sessions':
            setPalette('sessions')
            break
          case 'prev-tab':
          case 'next-tab': {
            const list = tabsRef.current.filter((t) => !t.closedAt)
            if (!list.length) break
            const i = list.findIndex((t) => t.key === activeRef.current)
            const n = (i + (cmd === 'next-tab' ? 1 : -1) + list.length) % list.length
            setActiveKey(list[n].key)
            break
          }
          default:
            emitCommand(cmd)
        }
      }),
    []
  )

  useEffect(() => saveNum('sidebarWidth', sidebarWidth), [sidebarWidth])

  const startResize = (e: React.MouseEvent): void => {
    const startX = e.clientX
    const startW = sidebarWidth
    const move = (ev: MouseEvent): void => setSidebarWidth(Math.max(180, Math.min(480, startW + ev.clientX - startX)))
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const groups = [...new Set(sessions.map((s) => s.group).filter(Boolean))]

  function focusQuickConnect(): void {
    setSidebarOpen(true)
    setTimeout(() => (document.querySelector('[data-quick-connect]') as HTMLInputElement | null)?.focus(), 50)
  }

  /** 命令面板条目：已打开的标签页、已保存的会话、操作 */
  const buildPalette = (mode: 'sessions' | 'all'): PaletteItem[] => {
    const activeTab = visibleTabs.find((t) => t.key === activeKey)
    const toggle = (key: keyof typeof settings, label: string): PaletteItem => ({
      id: 'toggle-' + key,
      group: '设置',
      label: `${settings[key] ? '关闭' : '开启'}：${label}`,
      run: () => updateSettings({ [key]: !settings[key] })
    })
    const tabItems: PaletteItem[] = visibleTabs.map((t, i) => ({
      id: 'tab-' + t.key,
      group: '已打开的标签页',
      label: t.title,
      hint: `${t.protocol === 'ftp' ? 'FTP' : 'SSH'} · ${t.status === 'connected' ? '已连接' : t.status === 'connecting' ? '连接中' : '未连接'}`,
      keywords: 'tab 标签 ' + i,
      run: () => setActiveKey(t.key)
    }))
    const sessionItems: PaletteItem[] = [...sessions]
      .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
      .map((x) => ({
        id: 'session-' + x.id,
        group: '连接会话',
        label: x.name,
        hint: `${x.protocol === 'ftp' ? 'FTP' : 'SSH'} ${x.username}@${x.host}${x.port !== (x.protocol === 'ftp' ? 21 : 22) ? ':' + x.port : ''}${x.group ? ' · ' + x.group : ''}`,
        keywords: `${x.host} ${x.username} ${x.group}`,
        run: () => connectSession(x)
      }))
    if (mode === 'sessions') return [...tabItems, ...sessionItems]
    const cmd = (id: string, label: string, shortcut: string | undefined, run: () => void, keywords?: string): PaletteItem => ({
      id: 'cmd-' + id,
      group: '操作',
      label,
      shortcut,
      keywords,
      run
    })
    const actions: PaletteItem[] = [
      cmd('new-session', '新建会话', k('new-session'), () => setEditing({}), 'new add'),
      cmd('quick', '快速连接', k('quick-connect'), focusQuickConnect, 'quick connect'),
      cmd('settings', '打开设置', k('settings'), () => setSettingsOpen('appearance'), 'settings preferences 偏好'),
      cmd('whats-new', '新功能介绍', undefined, () => setWhatsNew(true), "what's new help 帮助 引导 介绍"),
      cmd('shortcuts', '快捷键一览', k('shortcuts'), () => setShortcutsOpen(true), 'shortcuts keys help 帮助 快捷键'),
      cmd('sidebar', sidebarOpen ? '隐藏会话列表' : '显示会话列表', k('toggle-sidebar'), () => setSidebarOpen(!sidebarOpen), 'sidebar'),
      cmd('font+', '放大字体', k('font-bigger'), () => updateSettings({ fontSize: Math.min(32, settings.fontSize + 1) }), 'font zoom'),
      cmd('font-', '缩小字体', k('font-smaller'), () => updateSettings({ fontSize: Math.max(9, settings.fontSize - 1) }), 'font zoom'),
      cmd('font0', '重置字体大小', k('font-reset'), () => updateSettings({ fontSize: 14 }), 'font zoom'),
      cmd('reopen', '重新打开关闭的标签页', k('reopen-tab'), () => void reopenTab(), 'undo reopen 撤销'),
      cmd('quick', '显示 / 隐藏 Quick Terminal', undefined, () => void window.api.quick.toggle(), 'quick terminal dropdown 下拉 快捷终端'),
      cmd('appearance-dark', '切换到深色外观', undefined, () => updateSettings({ appearance: 'dark' }), 'theme dark 主题 外观'),
      cmd('appearance-light', '切换到浅色外观', undefined, () => updateSettings({ appearance: 'light' }), 'theme light 主题 外观'),
      cmd('appearance-system', '外观跟随系统', undefined, () => updateSettings({ appearance: 'system' }), 'theme system 主题 外观')
    ]
    if (activeTab) {
      if (activeTab.protocol === 'ssh') {
        actions.push(
          cmd('v-term', '切换到终端', k('view-terminal'), () => updateTab(activeTab.key, { view: 'terminal' }), 'terminal view'),
          cmd('v-files', '切换到文件传输', k('view-files'), () => updateTab(activeTab.key, { view: 'files' }), 'files sftp view'),
          cmd('v-split', '终端 + 文件传输同时显示', k('view-split'), () => updateTab(activeTab.key, { view: 'split' }), 'split view'),
          cmd('split-right', '向右拆分终端', k('split-right'), () => splitFocused('row'), 'split pane 分屏'),
          cmd('split-down', '向下拆分终端', k('split-down'), () => splitFocused('col'), 'split pane 分屏'),
          cmd('find', '在终端中查找', k('find'), () => emitCommand('find'), 'search find'),
          cmd('clear', '清屏', k('clear'), () => emitCommand('clear'), 'clear'),
          cmd('save-output', '将终端输出保存为文件', k('save-output'), () => emitCommand('save-output'), 'save export log')
        )
      }
      const sess = sessions.find((x) => x.id === activeTab.sessionId)
      if (sess) actions.push(cmd('edit-session', `编辑会话「${sess.name}」`, undefined, () => setEditing({ session: sess }), 'edit'))
      if (activeTab.protocol === 'ssh' && leaves(activeTab.tree).length > 1) {
        actions.push(
          cmd('zoom', activeTab.zoomed ? '还原分屏' : '放大当前分屏', k('zoom-pane'), () => updateTab(activeTab.key, (x) => ({ zoomed: x.zoomed ? null : x.focusedPane })), 'zoom pane 分屏'),
          cmd('equalize', '均分所有分屏', k('equalize-panes'), () => updateTab(activeTab.key, (x) => ({ tree: equalize(x.tree) })), 'equalize pane 分屏'),
          cmd('close-pane', '关闭当前分屏', k('close-tab'), () => void closePane(activeTab.key, activeTab.focusedPane), 'close pane 分屏')
        )
      }
      actions.push(cmd('close-tab', `关闭标签页「${activeTab.title}」`, undefined, () => void closeTab(activeTab.key), 'close'))
    }
    const toggles = [
      toggle('pasteProtection', '粘贴保护'),
      toggle('copyOnSelect', '选中即复制'),
      toggle('osc52Write', '允许服务器写入剪贴板'),
      toggle('optionAsAlt', 'Option 键作为 Alt'),
      toggle('gpuRendering', 'GPU 加速渲染'),
      toggle('showHiddenFiles', '默认显示隐藏文件'),
      toggle('dimUnfocusedSplits', '未聚焦的分屏变暗'),
      toggle('bellNotify', '响铃提醒'),
      toggle('fontLigatures', '连字'),
      toggle('terminalImages', '在终端中显示图片'),
      toggle('backgroundBlur', '毛玻璃背景')
    ]
    return [...actions, ...tabItems, ...sessionItems, ...toggles]
  }
  const isMac = window.api.platform === 'darwin'

  return (
    <div className={'app' + (isMac ? ' mac' : '') + (IS_WIN ? ' win' : '')}>
      <div className="topbar">
        <div className="traffic-space" />
        {IS_WIN && (
          <button
            className="icon-btn nodrag app-menu-btn"
            title="菜单（文件、编辑、视图、帮助）"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              void window.api.app.popupMenu(r.left, r.bottom)
            }}
          >
            <img src="./icon.png" alt="" width="18" height="18" />
          </button>
        )}
        <button className="icon-btn nodrag" title={`会话列表 (${k('toggle-sidebar')})`} onClick={() => setSidebarOpen(!sidebarOpen)}>
          ☰
        </button>
        <div className="tabs nodrag">
          {visibleTabs.map((t) => (
            <div
              key={t.key}
              className={'tab' + (t.key === activeKey ? ' active' : '') + (t.attention ? ' attention' : '')}
              onMouseDown={(e) => {
                if (e.button === 1) void closeTab(t.key)
                else setActiveKey(t.key)
              }}
              title={t.error || t.title}
            >
              <span className={'dot ' + t.status} />
              <span className="tab-title">{t.title}</span>
              {t.attention && <span className="tab-bell" title="有新的提醒">●</span>}
              {t.protocol === 'ssh' && leaves(t.tree).length > 1 && <span className="tab-panes">{leaves(t.tree).length}</span>}
              <span
                className="tab-close"
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => void closeTab(t.key)}
              >
                ✕
              </span>
            </div>
          ))}
        </div>
        <div className="grow" />
        <div className="topbar-actions nodrag">
          <button className="search-pill" title="搜索服务器、标签页或任何操作" onClick={() => setPalette('all')}>
            <IconSearch size={13} />
            <span>搜索或执行命令</span>
            <kbd>{k('palette')}</kbd>
          </button>
          <button className="icon-btn" title="新功能介绍" onClick={() => setWhatsNew(true)}>
            <IconSparkle />
          </button>
          <button className="icon-btn" title={`快捷键一览 (${k('shortcuts')})`} onClick={() => setShortcutsOpen(true)}>
            <IconHelp />
          </button>
          <button className="icon-btn" title={`设置 (${k('settings')})`} onClick={() => setSettingsOpen('appearance')}>
            <IconGear />
          </button>
        </div>
      </div>
      <div className="body">
        {sidebarOpen && (
          <>
            <div style={{ width: sidebarWidth }} className="sidebar-wrap">
              <Sidebar
                sessions={sessions}
                onConnect={connectSession}
                onNew={() => setEditing({})}
                onEdit={(s) => setEditing({ session: s })}
                onDuplicate={async (s) => {
                  await window.api.sessions.duplicate(s.id)
                  void reload()
                }}
                onDelete={(s) => void deleteSession(s)}
                onQuick={(t) => void quickConnect(t)}
              />
            </div>
            <div className="splitter" onMouseDown={startResize} />
          </>
        )}
        <div className="main">
          {visibleTabs.length === 0 && (
            <div className="welcome">
              <div className="welcome-logo">SSHub</div>
              <div className="muted">SSH 终端 · SFTP / FTP 文件传输</div>
              <div className="welcome-actions">
                <button className="primary" onClick={() => setEditing({})}>
                  新建会话
                </button>
                <button onClick={focusQuickConnect}>快速连接</button>
              </div>
              <div className="welcome-grid">
                <button className="welcome-card" onClick={() => setPalette('sessions')}>
                  <IconSearch />
                  <b>搜索服务器</b>
                  <span>输入名称或 IP，回车连接</span>
                  <kbd>{k('palette-sessions')}</kbd>
                </button>
                <button className="welcome-card" onClick={() => setPalette('all')}>
                  <IconCommand />
                  <b>命令面板</b>
                  <span>搜索并执行任何操作</span>
                  <kbd>{k('palette')}</kbd>
                </button>
                <button className="welcome-card" onClick={() => setSettingsOpen('quick')}>
                  <IconBolt />
                  <b>Quick Terminal</b>
                  <span>全局快捷键呼出下拉终端</span>
                  <kbd>设置</kbd>
                </button>
                <button className="welcome-card" onClick={() => setSettingsOpen('appearance')}>
                  <IconGear />
                  <b>外观与主题</b>
                  <span>深浅色、终端配色、透明度</span>
                  <kbd>{k('settings')}</kbd>
                </button>
                <button className="welcome-card" onClick={() => setWhatsNew(true)}>
                  <IconSparkle />
                  <b>新功能介绍</b>
                  <span>分屏、通知、在线编辑…</span>
                  <kbd>帮助</kbd>
                </button>
                <button className="welcome-card" onClick={() => setShortcutsOpen(true)}>
                  <IconHelp />
                  <b>快捷键一览</b>
                  <span>所有快捷键</span>
                  <kbd>{k('shortcuts')}</kbd>
                </button>
              </div>
            </div>
          )}
          {tabs.map((t) => {
            const active = t.key === activeKey
            const showTerm = t.view !== 'files'
            const showFiles = t.view !== 'terminal'
            return (
              <div key={t.key} className={'tab-page view-' + t.view} style={{ display: active ? 'flex' : 'none' }}>
                <div className="tab-toolbar">
                  {t.protocol === 'ftp' ? (
                    <span className="proto-badge ftp">FTP 文件传输</span>
                  ) : (
                  <div className="segmented small">
                    {(
                      [
                        ['terminal', '终端'],
                        ['files', '文件传输'],
                        ['split', '终端+文件']
                      ] as [View, string][]
                    ).map(([v, l]) => (
                      <button key={v} className={t.view === v ? 'active' : ''} onClick={() => updateTab(t.key, { view: v })}>
                        {l}
                      </button>
                    ))}
                  </div>
                  )}
                  <span className={'status-text ' + t.status}>
                    {t.status === 'connecting' && '连接中…'}
                    {t.status === 'connected' && '已连接'}
                    {t.status === 'closed' && '已断开'}
                    {t.status === 'error' && '连接失败'}
                  </span>
                  <span className="grow" />
                  {t.protocol === 'ssh' && t.view !== 'files' && (
                    <div className="tool-buttons">
                      <button className="tb-btn" title={`向右拆分终端 (${k('split-right')})`} onClick={() => (setActiveKey(t.key), splitFocused('row'))}>
                        <IconSplitRight />
                        <span>向右拆分</span>
                      </button>
                      <button className="tb-btn" title={`向下拆分终端 (${k('split-down')})`} onClick={() => (setActiveKey(t.key), splitFocused('col'))}>
                        <IconSplitDown />
                        <span>向下拆分</span>
                      </button>
                      {leaves(t.tree).length > 1 && (
                        <button
                          className={'tb-btn' + (t.zoomed ? ' on' : '')}
                          title={`放大 / 还原当前分屏 (${k('zoom-pane')})`}
                          onClick={() => updateTab(t.key, (x) => ({ zoomed: x.zoomed ? null : x.focusedPane }))}
                        >
                          <IconZoom />
                        </button>
                      )}
                      <button className="tb-btn" title={`在终端中查找 (${k('find')})`} onClick={() => emitCommand('find')}>
                        <IconSearch />
                      </button>
                      <button
                        className="tb-btn"
                        title="更多操作"
                        onClick={(e) => {
                          const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                          const multi = leaves(t.tree).length > 1
                          setMoreMenu({
                            x: r.left,
                            y: r.bottom + 4,
                            items: [
                              { label: `清屏  ${k('clear')}`, onClick: () => emitCommand('clear') },
                              { label: `将终端输出保存为文件…  ${k('save-output')}`, onClick: () => emitCommand('save-output') },
                              { type: 'separator' },
                              { label: `均分所有分屏  ${k('equalize-panes')}`, disabled: !multi, onClick: () => updateTab(t.key, (x) => ({ tree: equalize(x.tree) })) },
                              { label: `关闭当前分屏  ${k('close-tab')}`, disabled: !multi, onClick: () => void closePane(t.key, t.focusedPane) },
                              { type: 'separator' },
                              { label: '终端设置…', onClick: () => setSettingsOpen('terminal') }
                            ]
                          })
                        }}
                      >
                        <IconMore />
                      </button>
                    </div>
                  )}
                </div>
                {t.protocol === 'ftp' ? (
                  <div className="tab-content">
                    <FtpView
                      active={active}
                      prepare={getPrepare(t.key)}
                      notify={notify}
                      onStatus={(status, conn, error) =>
                        updateTab(t.key, conn ? { status, conn, error } : { status, error })
                      }
                    />
                  </div>
                ) : (
                <div className="tab-content">
                  <div className="term-area" style={{ display: showTerm ? 'flex' : 'none' }}>
                    <SplitView
                      tree={t.tree}
                      order={t.order}
                      focused={t.focusedPane}
                      zoomed={t.zoomed}
                      dimUnfocused={settings.dimUnfocusedSplits}
                      onFocus={(id) => updateTab(t.key, { focusedPane: id })}
                      onRatio={(splitId, r) => updateTab(t.key, (x) => ({ tree: setRatio(x.tree, splitId, r) }))}
                      renderPane={(id) => (
                        <TerminalView
                          active={active && id === t.focusedPane}
                          visible={active && showTerm && (t.zoomed === null || t.zoomed === id)}
                          title={t.title}
                          settings={settings}
                          theme={termTheme.colors}
                          prepare={getPrepare(t.key)}
                          onFocus={() => t.focusedPane !== id && updateTab(t.key, { focusedPane: id })}
                          onAttention={(kind, msg) => onAttention(t.key, id, kind, msg)}
                          onStatus={(status, conn, error) => onPaneStatus(t.key, id, status, conn, error)}
                        />
                      )}
                    />
                  </div>
                  {showFiles && (
                    <div className="files-area">
                      {t.conn && t.status === 'connected' ? (
                        <FilesView key={t.conn.connId} connId={t.conn.connId} homeDir={t.conn.homeDir} active={active} notify={notify} />
                      ) : (
                        <div className="pane-msg">{t.status === 'connecting' ? '正在连接…' : '未连接，请在终端中按 Enter 重新连接'}</div>
                      )}
                    </div>
                  )}
                </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {whatsNew && (
        <WhatsNew
          version={version}
          onClose={closeWhatsNew}
          actions={{
            openPalette: () => setPalette('all'),
            openSettings: (tab) => setSettingsOpen(tab),
            splitRight: () => splitFocused('row'),
            openShortcuts: () => setShortcutsOpen(true),
            canSplit: !!visibleTabs.find((x) => x.key === activeKey && x.protocol === 'ssh' && x.status === 'connected')
          }}
        />
      )}
      {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
      {moreMenu && <ContextMenu {...moreMenu} onClose={() => setMoreMenu(null)} />}
      {settingsOpen && (
        <SettingsDialog
          initialTab={settingsOpen}
          settings={settings}
          onChange={updateSettings}
          onReset={async () => {
            if (await window.api.ui.confirm('恢复所有设置为默认值？')) await window.api.settings.reset()
          }}
          onClose={() => setSettingsOpen(null)}
        />
      )}
      {palette && (
        <CommandPalette
          key={palette}
          items={buildPalette(palette)}
          placeholder={palette === 'sessions' ? '搜索会话或标签页，回车连接 / 切换…' : '输入命令、会话名称或主机…'}
          onClose={() => setPalette(null)}
        />
      )}
      {editing && (
        <SessionDialog
          session={editing.session}
          groups={groups}
          onClose={() => setEditing(null)}
          onSaved={(s, connect) => {
            setEditing(null)
            void reload().then(() => {
              if (connect) connectSession(s)
            })
          }}
        />
      )}
      {prompt && (
        <PromptDialog
          opts={prompt.opts}
          onDone={(v, c) => {
            prompt.resolve(v, c)
            setPrompt(null)
          }}
        />
      )}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={'toast' + (t.error ? ' error' : '')}>
            <span>{t.msg}</span>
            {t.action && (
              <button
                className="toast-action"
                onClick={() => {
                  dismissToast(t.id)
                  t.action!.run()
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
