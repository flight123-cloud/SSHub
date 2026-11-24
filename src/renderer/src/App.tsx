import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectRequest, ConnectResult, SessionInfo } from '../../shared/types'
import { emitCommand, startBus } from './bus'
import { Sidebar } from './components/Sidebar'
import { SessionDialog } from './components/SessionDialog'
import { PromptDialog, type PromptOptions } from './components/Modal'
import { TerminalView, type ConnStatus } from './components/TerminalView'
import { FilesView } from './components/FilesView'
import { errMsg, parseQuick, uid } from './util'

type View = 'terminal' | 'files' | 'split'

interface Tab {
  key: string
  title: string
  sessionId?: string
  quick?: { host: string; port: number; username: string; password?: string }
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
  const [fontSize, setFontSize] = useState(() => loadNum('fontSize', 14))
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
    setTabs((list) => [...list, { ...tab, key, status: 'connecting', view: 'terminal' }])
    setActiveKey(key)
  }

  const connectSession = (s: SessionInfo): void => openTab({ title: s.name, sessionId: s.id })

  const quickConnect = async (text: string): Promise<void> => {
    const q = parseQuick(text)
    if (!q) return notify('格式不正确，请输入 user@host 或 user@host:port', true)
    const r = await ask({
      title: `连接 ${q.username}@${q.host}:${q.port}`,
      label: '密码（留空则使用本机 SSH 密钥 / Agent）',
      password: true,
      okText: '连接'
    })
    if (r.value === null) return
    openTab({ title: `${q.username}@${q.host}`, quick: { ...q, password: r.value || undefined } })
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
      if (s.authType === 'password' && (!s.hasPassword || retryAuth)) {
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
    if (tab.status === 'connected' && !(await window.api.ui.confirm(`断开并关闭「${tab.title}」？`))) return
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
            setSidebarOpen(true)
            setTimeout(() => (document.querySelector('[data-quick-connect]') as HTMLInputElement | null)?.focus(), 50)
            break
          case 'close-tab':
            if (active) void closeTab(active.key)
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
            setFontSize((f) => Math.min(32, f + 1))
            break
          case 'font-smaller':
            setFontSize((f) => Math.max(9, f - 1))
            break
          case 'font-reset':
            setFontSize(14)
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

  useEffect(() => saveNum('fontSize', fontSize), [fontSize])
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
              <div className="muted">SSH 终端 · SFTP 文件传输</div>
              <div className="welcome-actions">
                <button className="primary" onClick={() => setEditing({})}>
                  新建会话
                </button>
                <button onClick={() => emitMenu('quick-connect', setSidebarOpen)}>快速连接</button>
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
                  <span className={'status-text ' + t.status}>
                    {t.status === 'connecting' && '连接中…'}
                    {t.status === 'connected' && '已连接'}
                    {t.status === 'closed' && '已断开'}
                    {t.status === 'error' && '连接失败'}
                  </span>
                </div>
                <div className="tab-content">
                  <div className="term-area" style={{ display: showTerm ? 'flex' : 'none' }}>
                    <TerminalView
                      active={active}
                      visible={active && showTerm}
                      fontSize={fontSize}
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
              </div>
            )
          })}
        </div>
      </div>

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

function emitMenu(cmd: string, setSidebarOpen: (v: boolean) => void): void {
  if (cmd === 'quick-connect') {
    setSidebarOpen(true)
    setTimeout(() => (document.querySelector('[data-quick-connect]') as HTMLInputElement | null)?.focus(), 50)
  }
}
