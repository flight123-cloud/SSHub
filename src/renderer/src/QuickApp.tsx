import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConnectRequest, SessionInfo } from '../../shared/types'
import { emitCommand, startBus } from './bus'
import { PromptDialog, type PromptOptions } from './components/Modal'
import { TerminalView, type ConnStatus } from './components/TerminalView'
import { getSettings, updateSettings, useIsDark, useSettings } from './settings'
import { useTerminalTheme } from './themes'
import { errMsg, formatAccelerator } from './util'

startBus()

/**
 * Quick Terminal 窗口：从屏幕顶部滑出的单终端窗口。
 * 选定的会话会被记住，下次呼出时自动连接；窗口隐藏时连接保持。
 */
export default function QuickApp() {
  const settings = useSettings()
  const isDark = useIsDark()
  const theme = useTerminalTheme(settings, isDark)
  const [sessions, setSessions] = useState<SessionInfo[]>([])
  const [status, setStatus] = useState<ConnStatus>('connecting')
  const [gen, setGen] = useState(0)
  const [error, setError] = useState('')
  const [prompt, setPrompt] = useState<{ opts: PromptOptions; resolve: (v: string | null, c: boolean) => void } | null>(null)
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const reload = useCallback(async () => {
    try {
      setSessions(await window.api.sessions.list())
    } catch (e) {
      setError(errMsg(e))
    }
  }, [])

  useEffect(() => {
    void reload()
    // 每次呼出时刷新会话列表（主窗口里可能新增了会话）
    return window.api.quick.onShown(() => {
      void reload()
      ;(document.querySelector('.xterm-helper-textarea') as HTMLElement | null)?.focus()
    })
  }, [reload])

  const session = sessions.find((s) => s.id === settings.quickTerminalSessionId)

  const ask = (opts: PromptOptions): Promise<{ value: string | null; checked: boolean }> =>
    new Promise((resolve) => setPrompt({ opts, resolve: (value, checked) => resolve({ value, checked }) }))

  const prepare = async (retryAuth: boolean): Promise<Omit<ConnectRequest, 'cols' | 'rows'> | null> => {
    const s = sessionsRef.current.find((x) => x.id === getSettings().quickTerminalSessionId)
    if (!s) return null
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

  // 菜单快捷键：⌘W 隐藏窗口，其余转给终端
  useEffect(
    () =>
      window.api.ui.onMenu((cmd) => {
        if (cmd === 'close-tab') void window.api.quick.hide()
        else if (cmd === 'font-bigger') updateSettings({ fontSize: Math.min(32, getSettings().fontSize + 1) })
        else if (cmd === 'font-smaller') updateSettings({ fontSize: Math.max(9, getSettings().fontSize - 1) })
        else if (cmd === 'font-reset') updateSettings({ fontSize: 14 })
        else emitCommand(cmd)
      }),
    []
  )

  // FTP 会话没有终端，Quick Terminal 只列出 SSH 会话
  const sshSessions = sessions.filter((s) => s.protocol === 'ssh')

  return (
    <div className="quick-app">
      <div className="quick-bar">
        <span className="quick-title">Quick Terminal</span>
        <select
          className="mini-select"
          value={session ? session.id : ''}
          onChange={(e) => {
            updateSettings({ quickTerminalSessionId: e.target.value })
            setGen((g) => g + 1)
          }}
        >
          <option value="">选择会话…</option>
          {sshSessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}（{s.username}@{s.host}）
            </option>
          ))}
        </select>
        {session && (
          <span className={'status-text ' + status}>
            {status === 'connecting' && '连接中…'}
            {status === 'connected' && '已连接'}
            {status === 'closed' && '已断开（按 Enter 重连）'}
            {status === 'error' && '连接失败（按 Enter 重试）'}
          </span>
        )}
        <span className="grow" />
        <span className="muted small">{formatAccelerator(settings.quickTerminalHotkey)} 显示 / 隐藏</span>
        <button className="icon-btn" title="隐藏" onClick={() => void window.api.quick.hide()}>
          ✕
        </button>
      </div>
      <div className="quick-body">
        {session ? (
          <TerminalView
            key={session.id + ':' + gen}
            active
            visible
            title={session.name}
            settings={settings}
            theme={theme.colors}
            prepare={prepare}
            onStatus={(s) => setStatus(s)}
          />
        ) : (
          <div className="quick-pick">
            <div className="muted">选择一个会话，以后按快捷键呼出时会自动连接它</div>
            {error && <div className="error-text">{error}</div>}
            <div className="quick-pick-list">
              {sshSessions.map((s) => (
                <button key={s.id} onClick={() => updateSettings({ quickTerminalSessionId: s.id })}>
                  <b>{s.name}</b>
                  <span className="muted small">
                    {s.username}@{s.host}
                  </span>
                </button>
              ))}
              {sshSessions.length === 0 && <div className="muted small">还没有保存的 SSH 会话，请先在主窗口中新建</div>}
            </div>
          </div>
        )}
      </div>
      {prompt && (
        <PromptDialog
          opts={prompt.opts}
          onDone={(v, c) => {
            prompt.resolve(v, c)
            setPrompt(null)
          }}
        />
      )}
    </div>
  )
}
