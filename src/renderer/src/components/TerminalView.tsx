import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import type { ConnectRequest, ConnectResult } from '../../../shared/types'
import { bindConnection, onCommand } from '../bus'
import { errMsg } from '../util'
import { ContextMenu, type MenuItem } from './ContextMenu'

export type ConnStatus = 'connecting' | 'connected' | 'closed' | 'error'

export interface TerminalViewProps {
  active: boolean
  visible: boolean
  fontSize: number
  /** 每次（重新）连接前调用，返回 null 表示用户取消 */
  prepare: (retryAuth: boolean) => Promise<Omit<ConnectRequest, 'cols' | 'rows'> | null>
  onStatus: (status: ConnStatus, info?: ConnectResult, error?: string) => void
}

const THEME = {
  background: '#16171b',
  foreground: '#d8dae0',
  cursor: '#e6e6e6',
  cursorAccent: '#16171b',
  selectionBackground: '#3a4a6b',
  black: '#1e1f24',
  red: '#f07178',
  green: '#a6d189',
  yellow: '#e5c07b',
  blue: '#7aa2f7',
  magenta: '#c792ea',
  cyan: '#89ddff',
  white: '#d8dae0',
  brightBlack: '#5c6370',
  brightRed: '#ff8b92',
  brightGreen: '#c3e88d',
  brightYellow: '#ffcb6b',
  brightBlue: '#82aaff',
  brightMagenta: '#d7a5ff',
  brightCyan: '#a3f7ff',
  brightWhite: '#ffffff'
}

export function TerminalView(props: TerminalViewProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const connIdRef = useRef<string | null>(null)
  const statusRef = useRef<ConnStatus>('connecting')
  const unbindRef = useRef<(() => void) | null>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const [findOpen, setFindOpen] = useState(false)
  const [findText, setFindText] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  const setStatus = (s: ConnStatus, info?: ConnectResult, err?: string): void => {
    statusRef.current = s
    propsRef.current.onStatus(s, info, err)
  }

  const doFit = (): void => {
    const el = hostRef.current
    const term = termRef.current
    if (!el || !term || el.clientWidth < 20 || el.clientHeight < 20) return
    try {
      fitRef.current?.fit()
    } catch {
      return
    }
    if (connIdRef.current) window.api.ssh.resize(connIdRef.current, term.cols, term.rows)
  }

  const connect = async (retryAuth = false): Promise<void> => {
    const term = termRef.current!
    setStatus('connecting')
    const req = await propsRef.current.prepare(retryAuth)
    if (!req) {
      term.writeln('\r\n\x1b[33m已取消连接。按 Enter 重新连接。\x1b[0m')
      setStatus('closed')
      return
    }
    term.writeln(`\x1b[90m正在连接…\x1b[0m`)
    try {
      const res = await window.api.ssh.connect({ ...req, cols: term.cols, rows: term.rows })
      connIdRef.current = res.connId
      unbindRef.current?.()
      unbindRef.current = bindConnection(res.connId, {
        data: (d) => term.write(d),
        close: () => {
          connIdRef.current = null
          term.writeln('\r\n\x1b[33m[连接已断开] 按 Enter 重新连接。\x1b[0m')
          setStatus('closed')
        },
        error: (msg) => term.writeln(`\r\n\x1b[31m${msg}\x1b[0m`)
      })
      setStatus('connected', res)
      doFit()
      term.focus()
    } catch (e) {
      const msg = errMsg(e)
      term.writeln(`\x1b[31m连接失败：${msg}\x1b[0m`)
      term.writeln('\x1b[33m按 Enter 重新连接。\x1b[0m')
      authFailedRef.current = /认证失败/.test(msg)
      setStatus('error', undefined, msg)
    }
  }
  const authFailedRef = useRef(false)

  useEffect(() => {
    const term = new Terminal({
      fontFamily: '"SF Mono", Menlo, Monaco, "PingFang SC", "Courier New", monospace',
      fontSize: props.fontSize,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 10000,
      allowProposedApi: true,
      macOptionClickForcesSelection: true,
      theme: THEME
    })
    const fit = new FitAddon()
    const search = new SearchAddon()
    const unicode = new Unicode11Addon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.loadAddon(unicode)
    term.loadAddon(new WebLinksAddon((_e, uri) => window.open(uri)))
    term.unicode.activeVersion = '11'
    termRef.current = term
    fitRef.current = fit
    searchRef.current = search
    term.open(hostRef.current!)
    doFit()

    term.onData((d) => {
      const id = connIdRef.current
      if (id && statusRef.current === 'connected') window.api.ssh.write(id, d)
      else if ((statusRef.current === 'closed' || statusRef.current === 'error') && d === '\r') {
        void connect(authFailedRef.current)
      }
    })

    const ro = new ResizeObserver(() => doFit())
    ro.observe(hostRef.current!)
    void connect()

    return () => {
      ro.disconnect()
      unbindRef.current?.()
      if (connIdRef.current) void window.api.ssh.disconnect(connIdRef.current)
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.options.fontSize = props.fontSize
    doFit()
  }, [props.fontSize])

  useEffect(() => {
    if (props.visible) {
      requestAnimationFrame(() => {
        doFit()
        if (props.active) termRef.current?.focus()
      })
    }
  }, [props.visible, props.active])

  useEffect(
    () =>
      onCommand((cmd) => {
        if (!propsRef.current.active || !propsRef.current.visible) return
        if (cmd === 'clear') termRef.current?.clear()
        if (cmd === 'find') setFindOpen(true)
      }),
    []
  )

  const findNext = (back = false): void => {
    if (!findText) return
    const opts = { decorations: { matchOverviewRuler: '#e5c07b', activeMatchColorOverviewRuler: '#f07178', matchBackground: '#5a4a1a', activeMatchBackground: '#8a5a1a' } }
    if (back) searchRef.current?.findPrevious(findText, opts)
    else searchRef.current?.findNext(findText, opts)
  }

  const menuItems: MenuItem[] = [
    {
      label: '复制',
      disabled: !termRef.current?.hasSelection(),
      onClick: () => void window.api.ui.copyText(termRef.current?.getSelection() ?? '')
    },
    {
      label: '粘贴',
      onClick: () => {
        void navigator.clipboard.readText().then((t) => {
          if (t) termRef.current?.paste(t)
        })
      }
    },
    { label: '全选', onClick: () => termRef.current?.selectAll() },
    { type: 'separator' },
    { label: '查找…', onClick: () => setFindOpen(true) },
    { label: '清屏', onClick: () => termRef.current?.clear() },
    { type: 'separator' },
    {
      label: '重新连接',
      onClick: () => {
        if (connIdRef.current) void window.api.ssh.disconnect(connIdRef.current)
        connIdRef.current = null
        setTimeout(() => void connect(), 200)
      }
    }
  ]

  return (
    <div className="terminal-wrap" onContextMenu={(e) => (e.preventDefault(), setMenu({ x: e.clientX, y: e.clientY }))}>
      <div ref={hostRef} className="terminal-host" />
      {findOpen && (
        <div className="find-bar">
          <input
            className="input"
            autoFocus
            placeholder="查找"
            value={findText}
            onChange={(e) => setFindText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') findNext(e.shiftKey)
              if (e.key === 'Escape') {
                setFindOpen(false)
                searchRef.current?.clearDecorations()
                termRef.current?.focus()
              }
            }}
          />
          <button onClick={() => findNext(true)}>↑</button>
          <button onClick={() => findNext(false)}>↓</button>
          <button
            onClick={() => {
              setFindOpen(false)
              searchRef.current?.clearDecorations()
              termRef.current?.focus()
            }}
          >
            ✕
          </button>
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </div>
  )
}
