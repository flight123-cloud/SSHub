import { KEYMAP, type KeyId } from '../../shared/keymap'
import { IS_MAC } from './keys'

/**
 * 应用命令：来自菜单（主进程）或本地快捷键。
 *
 * macOS 上快捷键由原生菜单处理；Windows / Linux 上菜单只显示快捷键、不拦截按键，
 * 由这里在捕获阶段统一识别——这样终端拿不到这些组合键（不会误发控制字符），
 * 其余按键（Ctrl+C、Ctrl+D、Ctrl+W……）照常交给终端。
 */
type Listener = (cmd: string) => void
const listeners = new Set<Listener>()

export function onAppCommand(l: Listener): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

function dispatch(cmd: string): void {
  listeners.forEach((l) => l(cmd))
}

interface Combo {
  ctrl: boolean
  alt: boolean
  shift: boolean
  code: string
}

const CODE: Record<string, string> = {
  '=': 'Equal',
  plus: 'Equal',
  '-': 'Minus',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  ',': 'Comma',
  '/': 'Slash',
  '`': 'Backquote',
  tab: 'Tab',
  enter: 'Enter',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown'
}

function parse(acc: string): Combo {
  // "Alt+Shift+-"、"Ctrl+=" 的最后一段可能是符号本身
  const parts = acc.split('+')
  let key = parts.pop() || '+'
  if (key === '' && parts.length) key = '+'
  const mods = parts.map((p) => p.toLowerCase())
  let shift = mods.includes('shift')
  const lower = key.toLowerCase()
  let code: string
  if (/^[a-z]$/.test(lower)) code = 'Key' + key.toUpperCase()
  else if (/^[0-9]$/.test(lower)) code = 'Digit' + key
  else if (/^f\d{1,2}$/.test(lower)) code = key.toUpperCase()
  else code = CODE[lower] ?? key
  if (lower === 'plus') shift = true
  return { ctrl: mods.includes('ctrl') || mods.includes('control'), alt: mods.includes('alt'), shift, code }
}

const BINDINGS: [Combo, KeyId][] = (Object.keys(KEYMAP) as KeyId[])
  .map((id) => [KEYMAP[id][1], id] as const)
  .filter((x): x is [string, KeyId] => !!x[0])
  .map(([acc, id]) => [parse(acc), id])

function matches(c: Combo, e: KeyboardEvent): boolean {
  if (e.metaKey || c.ctrl !== e.ctrlKey || c.alt !== e.altKey || c.shift !== e.shiftKey) return false
  if (c.code === 'Enter') return e.code === 'Enter' || e.code === 'NumpadEnter'
  return e.code === c.code
}

let started = false
export function startKeybindings(): void {
  if (started) return
  started = true
  // 菜单发来的命令
  window.api.ui.onMenu(dispatch)
  if (IS_MAC) return
  window.addEventListener(
    'keydown',
    (e) => {
      const t = e.target as HTMLElement | null
      // 设置里录制全局快捷键时不拦截
      if (t?.closest?.('[data-hotkey-recorder]')) return
      const hit = BINDINGS.find(([c]) => matches(c, e))
      if (!hit) return
      e.preventDefault()
      e.stopPropagation()
      dispatch(hit[1])
    },
    true
  )
}

/** 测试与调试用：当前平台的组合键是否被应用占用 */
export function isAppShortcut(e: KeyboardEvent): boolean {
  return !IS_MAC && BINDINGS.some(([c]) => matches(c, e))
}
