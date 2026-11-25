import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectRequest, ConnectResult, Protocol, QuickTarget, SessionInfo } from '../../shared/types'
import { emitCommand, startBus } from './bus'
import { Sidebar } from './components/Sidebar'
import { SessionDialog } from './components/SessionDialog'
import { PromptDialog, type PromptOptions } from './components/Modal'
import { TerminalView, type ConnStatus } from './components/TerminalView'
import { FilesView } from './components/FilesView'
import { FtpView } from './components/FtpView'
import { SettingsDialog } from './components/SettingsDialog'
import { CommandPalette, type PaletteItem } from './components/CommandPalette'
import { getSettings, updateSettings, useSettings } from './settings'
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
}

interface Toast {
  id: string
  msg: string
  error?: boolean
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
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  const notify = useCallback((msg: string, error = false) => {
    const id = uid()
    setToasts((t) => [...t, { id, msg, error }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), error ? 6000 : 3000)
  }, [])

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

  const updateTab = (key: string, patch: Partial<Tab>): void =>
    setTabs((list) => list.map((t) => (t.key === key ? { ...t, ...patch } : t)))

  const openTab = (tab: Omit<Tab, 'key' | 'status' | 'view'>): void => {
    const key = uid()
    setTabs((list) => [...list, { ...tab, key, status: 'connecting', view: tab.protocol === 'ftp' ? 'files' : 'terminal' }])
    setActiveKey(key)
  }

  const connectSession = (s: SessionInfo): void => openTab({ title: s.name, sessionId: s.id, protocol: s.protocol })

  const quickConnect = async (text: string): Promise<void> => {
    const q = parseQuick(text)
    if (!q) return notify('格式不正确。示例：root@1.2.3.4、user@host:2222、ftp://user@host', true)
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

  const closeTab = async (key: string): Promise<void> => {
    const tab = tabsRef.current.find((t) => t.key === key)
    if (!tab) return
    if (
      tab.status === 'connected' &&
      getSettings().confirmCloseConnected &&
      !(await window.api.ui.confirm(`断开并关闭「${tab.title}」？`))
    )
      return
    prepares.current.delete(key)
    setTabs((list) => {
      const idx = list.findIndex((t) => t.key === key)
      const next = list.filter((t) => t.key !== key)
      if (activeRef.current === key) setActiveKey(next[Math.min(idx, next.length - 1)]?.key ?? null)
      return next
    })
  }

  const deleteSession = async (s: SessionInfo): Promise<void> => {
    if (!(await window.api.ui.confirm(`删除会话「${s.name}」？`))) return
    await window.api.sessions.remove(s.id)
    void reload()
  }

  // 菜单命令
  useEffect(
    () =>
      window.api.ui.onMenu((cmd) => {
        const active = tabsRef.current.find((t) => t.key === activeRef.current)
        switch (cmd) {
          case 'new-session':
            setEditing({})
            break
          case 'quick-connect':
            focusQuickConnect()
            break
          case 'close-tab':
            // 打开了编辑器时，⌘W 只关闭编辑器
            if (document.querySelector('.modal.editor')) emitCommand('close-editor')
            else if (active) void closeTab(active.key)
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
            setSettingsOpen(true)
            break
          case 'palette':
            setPalette('all')
            break
          case 'palette-sessions':
            setPalette('sessions')
            break
          case 'prev-tab':
          case 'next-tab': {
            const list = tabsRef.current
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
    const activeTab = tabs.find((t) => t.key === activeKey)
    const toggle = (key: keyof typeof settings, label: string): PaletteItem => ({
      id: 'toggle-' + key,
      group: '设置',
      label: `${settings[key] ? '关闭' : '开启'}：${label}`,
      run: () => updateSettings({ [key]: !settings[key] })
    })
    const tabItems: PaletteItem[] = tabs.map((t, i) => ({
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
      cmd('new-session', '新建会话', '⌘N', () => setEditing({}), 'new add'),
      cmd('quick', '快速连接', '⌘K', focusQuickConnect, 'quick connect'),
      cmd('settings', '打开设置', '⌘,', () => setSettingsOpen(true), 'settings preferences 偏好'),
      cmd('sidebar', sidebarOpen ? '隐藏会话列表' : '显示会话列表', '⌘B', () => setSidebarOpen(!sidebarOpen), 'sidebar'),
      cmd('font+', '放大字体', '⌘+', () => updateSettings({ fontSize: Math.min(32, settings.fontSize + 1) }), 'font zoom'),
      cmd('font-', '缩小字体', '⌘-', () => updateSettings({ fontSize: Math.max(9, settings.fontSize - 1) }), 'font zoom'),
      cmd('font0', '重置字体大小', '⌘0', () => updateSettings({ fontSize: 14 }), 'font zoom')
    ]
    if (activeTab) {
      if (activeTab.protocol === 'ssh') {
        actions.push(
          cmd('v-term', '切换到终端', '⌘1', () => updateTab(activeTab.key, { view: 'terminal' }), 'terminal view'),
          cmd('v-files', '切换到文件传输', '⌘2', () => updateTab(activeTab.key, { view: 'files' }), 'files sftp view'),
          cmd('v-split', '切换到分屏', '⌘3', () => updateTab(activeTab.key, { view: 'split' }), 'split view'),
          cmd('find', '在终端中查找', '⌘F', () => emitCommand('find'), 'search find'),
          cmd('clear', '清屏', '⌘L', () => emitCommand('clear'), 'clear'),
          cmd('save-output', '将终端输出保存为文件', '⌘⇧S', () => emitCommand('save-output'), 'save export log')
        )
      }
      const sess = sessions.find((x) => x.id === activeTab.sessionId)
      if (sess) actions.push(cmd('edit-session', `编辑会话「${sess.name}」`, undefined, () => setEditing({ session: sess }), 'edit'))
      actions.push(cmd('close-tab', `关闭标签页「${activeTab.title}」`, '⌘W', () => void closeTab(activeTab.key), 'close'))
    }
    const toggles = [
      toggle('pasteProtection', '粘贴保护'),
      toggle('copyOnSelect', '选中即复制'),
      toggle('osc52Write', '允许服务器写入剪贴板'),
      toggle('optionAsAlt', 'Option 键作为 Alt'),
      toggle('gpuRendering', 'GPU 加速渲染'),
      toggle('showHiddenFiles', '默认显示隐藏文件')
    ]
    return [...actions, ...tabItems, ...sessionItems, ...toggles]
  }
  const isMac = window.api.platform === 'darwin'

  return (
    <div className={'app' + (isMac ? ' mac' : '')}>
      <div className="topbar">
        <div className="traffic-space" />
        <button className="icon-btn nodrag" title="会话列表 (⌘B)" onClick={() => setSidebarOpen(!sidebarOpen)}>
          ☰
        </button>
        <div className="tabs nodrag">
          {tabs.map((t) => (
            <div
              key={t.key}
              className={'tab' + (t.key === activeKey ? ' active' : '')}
              onMouseDown={(e) => {
                if (e.button === 1) void closeTab(t.key)
                else setActiveKey(t.key)
              }}
              title={t.error || t.title}
            >
              <span className={'dot ' + t.status} />
              <span className="tab-title">{t.title}</span>
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
          {tabs.length === 0 && (
            <div className="welcome">
              <div className="welcome-logo">SSHub</div>
              <div className="muted">SSH 终端 · SFTP / FTP 文件传输</div>
              <div className="welcome-actions">
                <button className="primary" onClick={() => setEditing({})}>
                  新建会话
                </button>
                <button onClick={focusQuickConnect}>快速连接</button>
              </div>
              <div className="muted small shortcuts">
                ⌘N 新建会话 · ⌘K 快速连接 · ⌘1/2/3 切换终端/文件/分屏 · ⌘W 关闭标签
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
                        ['split', '分屏']
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
                    <TerminalView
                      active={active}
                      visible={active && showTerm}
                      title={t.title}
                      settings={settings}
                      prepare={getPrepare(t.key)}
                      onStatus={(status, conn, error) =>
                        updateTab(t.key, conn ? { status, conn, error } : { status, error })
                      }
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

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          onChange={updateSettings}
          onReset={async () => {
            if (await window.api.ui.confirm('恢复所有设置为默认值？')) await window.api.settings.reset()
          }}
          onClose={() => setSettingsOpen(false)}
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
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  )
}
