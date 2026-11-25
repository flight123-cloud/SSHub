import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { ClipboardAddon } from '@xterm/addon-clipboard'
import type { AppSettings, ConnectRequest, ConnectResult } from '../../../shared/types'
import { bindConnection, onCommand } from '../bus'
import { errMsg } from '../util'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Modal } from './Modal'

export type ConnStatus = 'connecting' | 'connected' | 'closed' | 'error'

export interface TerminalViewProps {
  active: boolean
  visible: boolean
  title: string
  settings: AppSettings
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
  const [pasteAsk, setPasteAsk] = useState<string | null>(null)
  const [overlay, setOverlay] = useState<string | null>(null)
  const webglRef = useRef<WebglAddon | null>(null)
  const sizeRef = useRef<{ cols: number; rows: number } | null>(null)
  const overlayTimer = useRef<number | undefined>(undefined)
  const settingsRef = useRef(props.settings)
  settingsRef.current = props.settings

  /** 粘贴：多行内容且远程程序没开括号粘贴模式时，先确认 */
  const pasteText = (text: string): void => {
    const term = termRef.current
    if (!term || !text) return
    if (settingsRef.current.pasteProtection && /[\r\n]/.test(text) && !term.modes.bracketedPasteMode) {
      setPasteAsk(text)
      return
    }
    term.paste(text)
  }
  const pasteFromClipboard = (): void => {
    void navigator.clipboard.readText().then(pasteText)
  }

  /** GPU 渲染：WebGL 不可用或上下文丢失时自动退回普通渲染 */
  const applyRenderer = (gpu: boolean): void => {
    const term = termRef.current
    if (!term) return
    if (gpu && !webglRef.current) {
      try {
        const addon = new WebglAddon()
        addon.onContextLoss(() => {
          addon.dispose()
          webglRef.current = null
        })
        term.loadAddon(addon)
        webglRef.current = addon
      } catch {
        webglRef.current = null
      }
    } else if (!gpu && webglRef.current) {
      webglRef.current.dispose()
      webglRef.current = null
    }
  }

  const showSize = (cols: number, rows: number): void => {
    const prev = sizeRef.current
    sizeRef.current = { cols, rows }
    // 首次布局不提示，之后尺寸变化才显示（与 Ghostty 的 after-first 一致）
    if (!prev || (prev.cols === cols && prev.rows === rows) || !settingsRef.current.resizeOverlay) return
    setOverlay(`${cols} × ${rows}`)
    window.clearTimeout(overlayTimer.current)
    overlayTimer.current = window.setTimeout(() => setOverlay(null), 900)
  }

  const saveOutput = async (): Promise<void> => {
    const term = termRef.current
    if (!term) return
    const buf = term.buffer.active
    const lines: string[] = []
    for (let i = 0; i < buf.length; i++) {
      const line = buf.getLine(i)
      if (!line) continue
      // 软换行的行拼接回同一行
      if (line.isWrapped && lines.length) lines[lines.length - 1] += line.translateToString(true)
      else lines.push(line.translateToString(true))
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
    const d = new Date()
    const p = (x: number): string => String(x).padStart(2, '0')
    const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
    const name = `${propsRef.current.title.replace(/[\\/:*?"<>|]/g, '_')}-${stamp}.txt`
    await window.api.ui.saveText(name, lines.join('\n') + '\n')
  }

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
    showSize(term.cols, term.rows)
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
    const st = props.settings
    const term = new Terminal({
      fontFamily: st.fontFamily,
      fontSize: st.fontSize,
      lineHeight: st.lineHeight,
      cursorStyle: st.cursorStyle,
      cursorBlink: st.cursorBlink,
      scrollback: st.scrollback,
      minimumContrastRatio: st.minimumContrast,
      macOptionIsMeta: st.optionAsAlt,
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
    // OSC 52：允许服务器程序（vim / tmux）写入本机剪贴板；读取一律拒绝
    term.loadAddon(
      new ClipboardAddon(undefined, {
        readText: () => '',
        writeText: (_sel, text) => {
          if (settingsRef.current.osc52Write && text) void window.api.ui.copyText(text)
        }
      })
    )
    term.unicode.activeVersion = '11'
    termRef.current = term
    fitRef.current = fit
    searchRef.current = search
    term.open(hostRef.current!)
    applyRenderer(st.gpuRendering)
    doFit()

    // 选中即复制
    let selTimer: number | undefined
    term.onSelectionChange(() => {
      if (!settingsRef.current.copyOnSelect) return
      window.clearTimeout(selTimer)
      selTimer = window.setTimeout(() => {
        const text = term.getSelection()
        if (text) void window.api.ui.copyText(text)
      }, 120)
    })

    // 拦截粘贴（⌘V / 编辑菜单），在 xterm 处理之前做安全检查
    const onPaste = (e: ClipboardEvent): void => {
      const text = e.clipboardData?.getData('text/plain') ?? ''
      e.preventDefault()
      e.stopImmediatePropagation()
      pasteText(text)
    }
    const hostEl = hostRef.current!
    hostEl.addEventListener('paste', onPaste, true)

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
      hostEl.removeEventListener('paste', onPaste, true)
      window.clearTimeout(overlayTimer.current)
      unbindRef.current?.()
      if (connIdRef.current) void window.api.ssh.disconnect(connIdRef.current)
      term.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 设置变化时实时生效
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const st = props.settings
    const o = term.options
    if (o.fontFamily !== st.fontFamily) o.fontFamily = st.fontFamily
    if (o.fontSize !== st.fontSize) o.fontSize = st.fontSize
    if (o.lineHeight !== st.lineHeight) o.lineHeight = st.lineHeight
    if (o.cursorStyle !== st.cursorStyle) o.cursorStyle = st.cursorStyle
    if (o.cursorBlink !== st.cursorBlink) o.cursorBlink = st.cursorBlink
    if (o.scrollback !== st.scrollback) o.scrollback = st.scrollback
    if (o.minimumContrastRatio !== st.minimumContrast) o.minimumContrastRatio = st.minimumContrast
    if (o.macOptionIsMeta !== st.optionAsAlt) o.macOptionIsMeta = st.optionAsAlt
    applyRenderer(st.gpuRendering)
    doFit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.settings])

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
        if (cmd === 'save-output') void saveOutput()
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
      onClick: pasteFromClipboard
    },
    { label: '全选', onClick: () => termRef.current?.selectAll() },
    { type: 'separator' },
    { label: '查找…', onClick: () => setFindOpen(true) },
    { label: '清屏', onClick: () => termRef.current?.clear() },
    { label: '将终端输出保存为文件…', onClick: () => void saveOutput() },
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
    <div
      className="terminal-wrap"
      onContextMenu={(e) => {
        e.preventDefault()
        if (props.settings.rightClick === 'paste' && !e.ctrlKey) pasteFromClipboard()
        else setMenu({ x: e.clientX, y: e.clientY })
      }}
    >
      <div ref={hostRef} className="terminal-host" />
      {overlay && <div className="resize-overlay">{overlay}</div>}
      {pasteAsk !== null && (
        <PasteConfirm
          text={pasteAsk}
          onCancel={() => {
            setPasteAsk(null)
            termRef.current?.focus()
          }}
          onPaste={(t) => {
            setPasteAsk(null)
            termRef.current?.paste(t)
            termRef.current?.focus()
          }}
        />
      )}
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

/** 粘贴确认框：显示将要粘贴的内容，可以去掉末尾换行（避免立即执行） */
function PasteConfirm(props: { text: string; onCancel: () => void; onPaste: (text: string) => void }) {
  const lines = props.text.split(/\r\n|\r|\n/)
  const trailingNewline = /[\r\n]$/.test(props.text)
  const lineCount = trailingNewline ? lines.length - 1 : lines.length
  return (
    <Modal
      title="确认粘贴多行内容"
      width={560}
      onClose={props.onCancel}
      footer={
        <>
          <button onClick={props.onCancel}>取消</button>
          {trailingNewline && (
            <button onClick={() => props.onPaste(props.text.replace(/[\r\n]+$/, ''))}>去掉末尾换行后粘贴</button>
          )}
          <button className="primary" autoFocus onClick={() => props.onPaste(props.text)}>
            粘贴
          </button>
        </>
      }
    >
      <div className="warn-note small" style={{ marginTop: 0 }}>
        要粘贴的内容有 {lineCount} 行{trailingNewline ? '，且以换行结尾' : ''}。粘贴到终端后，每一行都可能被当作命令立即执行。
      </div>
      <pre className="paste-preview">{lines.slice(0, 30).join('\n')}{lines.length > 30 ? '\n…' : ''}</pre>
    </Modal>
  )
}
