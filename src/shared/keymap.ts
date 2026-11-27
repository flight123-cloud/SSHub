/**
 * 快捷键表：菜单绑定和界面上显示的快捷键都从这里读取。
 *
 * macOS 用 ⌘，不会和终端冲突；Windows / Linux 上 Ctrl+字母 是终端控制字符
 * （Ctrl+D 结束输入、Ctrl+W 删词、Ctrl+L 清屏、Ctrl+P 上一条历史……），
 * 所以那里的应用快捷键按 Windows Terminal 的习惯改用 Ctrl+Shift+字母。
 */
export type KeyId =
  | 'settings'
  | 'new-session'
  | 'quick-connect'
  | 'reopen-tab'
  | 'palette-sessions'
  | 'palette'
  | 'close-tab'
  | 'find'
  | 'clear'
  | 'save-output'
  | 'view-terminal'
  | 'view-files'
  | 'view-split'
  | 'split-right'
  | 'split-down'
  | 'zoom-pane'
  | 'equalize-panes'
  | 'pane-left'
  | 'pane-right'
  | 'pane-up'
  | 'pane-down'
  | 'pane-prev'
  | 'pane-next'
  | 'toggle-sidebar'
  | 'font-bigger'
  | 'font-smaller'
  | 'font-reset'
  | 'prev-tab'
  | 'next-tab'
  | 'shortcuts'
  | 'term-copy'
  | 'term-paste'

/** [macOS, Windows/Linux]，Electron accelerator 格式；undefined 表示该平台没有快捷键 */
export const KEYMAP: Record<KeyId, [string | undefined, string | undefined]> = {
  settings: ['Cmd+,', 'Ctrl+,'],
  'new-session': ['Cmd+N', 'Ctrl+Shift+N'],
  'quick-connect': ['Cmd+K', 'Ctrl+Shift+K'],
  'reopen-tab': ['Cmd+Shift+T', 'Ctrl+Shift+T'],
  'palette-sessions': ['Cmd+P', 'Ctrl+Shift+O'],
  palette: ['Cmd+Shift+P', 'Ctrl+Shift+P'],
  'close-tab': ['Cmd+W', 'Ctrl+Shift+W'],
  find: ['Cmd+F', 'Ctrl+Shift+F'],
  clear: ['Cmd+L', 'Ctrl+Shift+L'],
  'save-output': ['Cmd+Shift+S', 'Ctrl+Shift+S'],
  'view-terminal': ['Cmd+1', 'Ctrl+1'],
  'view-files': ['Cmd+2', 'Ctrl+2'],
  'view-split': ['Cmd+3', 'Ctrl+3'],
  'split-right': ['Cmd+D', 'Alt+Shift+Plus'],
  'split-down': ['Cmd+Shift+D', 'Alt+Shift+-'],
  'zoom-pane': ['Cmd+Shift+Enter', 'Ctrl+Shift+Enter'],
  'equalize-panes': ['Cmd+Ctrl+=', 'Ctrl+Alt+='],
  'pane-left': ['Cmd+Alt+Left', 'Ctrl+Alt+Left'],
  'pane-right': ['Cmd+Alt+Right', 'Ctrl+Alt+Right'],
  'pane-up': ['Cmd+Alt+Up', 'Ctrl+Alt+Up'],
  'pane-down': ['Cmd+Alt+Down', 'Ctrl+Alt+Down'],
  'pane-prev': ['Cmd+[', 'Ctrl+Shift+['],
  'pane-next': ['Cmd+]', 'Ctrl+Shift+]'],
  'toggle-sidebar': ['Cmd+B', 'Ctrl+Shift+B'],
  'font-bigger': ['Cmd+=', 'Ctrl+='],
  'font-smaller': ['Cmd+-', 'Ctrl+-'],
  'font-reset': ['Cmd+0', 'Ctrl+0'],
  'prev-tab': ['Cmd+Shift+[', 'Ctrl+Shift+Tab'],
  'next-tab': ['Cmd+Shift+]', 'Ctrl+Tab'],
  shortcuts: ['Cmd+/', 'F1'],
  // macOS 上终端复制粘贴就是 ⌘C / ⌘V（编辑菜单），不需要单独的项
  'term-copy': [undefined, 'Ctrl+Shift+C'],
  'term-paste': [undefined, 'Ctrl+Shift+V']
}

export function accelerator(id: KeyId, isMac: boolean): string | undefined {
  return KEYMAP[id][isMac ? 0 : 1]
}

const MAC_SYMBOLS: Record<string, string> = {
  cmd: '⌘',
  command: '⌘',
  cmdorctrl: '⌘',
  commandorcontrol: '⌘',
  ctrl: '⌃',
  control: '⌃',
  alt: '⌥',
  option: '⌥',
  shift: '⇧',
  enter: '↩',
  return: '↩',
  backspace: '⌫',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  plus: '+',
  space: '空格',
  tab: '⇥'
}

const PC_NAMES: Record<string, string> = {
  cmd: 'Ctrl',
  command: 'Ctrl',
  cmdorctrl: 'Ctrl',
  commandorcontrol: 'Ctrl',
  control: 'Ctrl',
  option: 'Alt',
  super: 'Win',
  left: '←',
  right: '→',
  up: '↑',
  down: '↓',
  plus: '+',
  space: 'Space'
}

/** accelerator → 显示文字：macOS「⌘⇧P」，Windows「Ctrl+Shift+P」 */
export function formatAccel(acc: string, isMac: boolean): string {
  const parts = acc.split('+').filter(Boolean)
  // "Alt+Shift+-" 这种以 - 结尾的没问题；"Ctrl+=" 也没问题
  if (isMac) return parts.map((k) => MAC_SYMBOLS[k.toLowerCase()] ?? k.toUpperCase()).join('')
  return parts.map((k) => PC_NAMES[k.toLowerCase()] ?? (k.length === 1 ? k.toUpperCase() : k)).join('+')
}

export function keyLabel(id: KeyId, isMac: boolean): string {
  const a = accelerator(id, isMac)
  return a ? formatAccel(a, isMac) : ''
}

/**
 * 把界面里写成 macOS 符号的快捷键（如「⌘S」「⌘⇧P」「⌘⌫」）转成当前平台的写法，
 * 用于编辑器、文件列表等不在快捷键表里的组合。
 */
export function platformKeys(macDisplay: string, isMac: boolean): string {
  if (isMac) return macDisplay
  const map: Record<string, string> = { '⌘': 'Ctrl', '⌃': 'Ctrl', '⌥': 'Alt', '⇧': 'Shift', '↩': 'Enter', '⌫': 'Delete', '⇥': 'Tab' }
  // 逐个处理连续的修饰键符号，最后接普通按键
  return macDisplay.replace(/[⌘⌃⌥⇧↩⌫⇥]+[^\s/，、·]*/g, (chunk) => {
    const mods: string[] = []
    let i = 0
    while (i < chunk.length && map[chunk[i]] && !(chunk[i] === '⌫' && mods.length)) {
      mods.push(map[chunk[i]])
      i++
    }
    const rest = chunk.slice(i)
    // 「⌘⌫」在 Windows 上就是 Delete 键
    if (macDisplay.includes('⌫') && mods.includes('Ctrl') && chunk.endsWith('⌫')) return 'Delete'
    const uniq = mods.filter((m, idx) => mods.indexOf(m) === idx)
    return [...uniq, rest ? rest.toUpperCase() : ''].filter(Boolean).join('+')
  })
}
