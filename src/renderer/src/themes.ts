import { useEffect, useMemo } from 'react'
import type { ITheme } from '@xterm/xterm'
import type { AppSettings } from '../../shared/types'

export interface TermTheme {
  id: string
  name: string
  dark: boolean
  colors: ITheme
}

/** 16 色调色板按 black red green yellow blue magenta cyan white，然后 bright 版本 */
function t(
  id: string,
  name: string,
  dark: boolean,
  bg: string,
  fg: string,
  cursor: string,
  selection: string,
  ansi: string[]
): TermTheme {
  const k = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white']
  const colors: ITheme = {
    background: bg,
    foreground: fg,
    cursor,
    cursorAccent: bg,
    selectionBackground: selection
  }
  ansi.forEach((c, i) => {
    const key = i < 8 ? k[i] : 'bright' + k[i - 8][0].toUpperCase() + k[i - 8].slice(1)
    ;(colors as Record<string, string>)[key] = c
  })
  return { id, name, dark, colors }
}

export const THEMES: TermTheme[] = [
  // ---------- 深色 ----------
  t('sshub-dark', 'SSHub 深色', true, '#16171b', '#d8dae0', '#e6e6e6', '#3a4a6b', [
    '#1e1f24', '#f07178', '#a6d189', '#e5c07b', '#7aa2f7', '#c792ea', '#89ddff', '#d8dae0',
    '#5c6370', '#ff8b92', '#c3e88d', '#ffcb6b', '#82aaff', '#d7a5ff', '#a3f7ff', '#ffffff'
  ]),
  t('one-dark', 'One Dark', true, '#282c34', '#abb2bf', '#528bff', '#3e4451', [
    '#282c34', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#abb2bf',
    '#5c6370', '#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd', '#56b6c2', '#ffffff'
  ]),
  t('dracula', 'Dracula', true, '#282a36', '#f8f8f2', '#f8f8f2', '#44475a', [
    '#21222c', '#ff5555', '#50fa7b', '#f1fa8c', '#bd93f9', '#ff79c6', '#8be9fd', '#f8f8f2',
    '#6272a4', '#ff6e6e', '#69ff94', '#ffffa5', '#d6acff', '#ff92df', '#a4ffff', '#ffffff'
  ]),
  t('solarized-dark', 'Solarized 深色', true, '#002b36', '#839496', '#93a1a1', '#073642', [
    '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
    '#586e75', '#cb4b16', '#93a1a1', '#839496', '#657b83', '#6c71c4', '#93a1a1', '#fdf6e3'
  ]),
  t('gruvbox-dark', 'Gruvbox 深色', true, '#282828', '#ebdbb2', '#ebdbb2', '#504945', [
    '#282828', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#a89984',
    '#928374', '#fb4934', '#b8bb26', '#fabd2f', '#83a598', '#d3869b', '#8ec07c', '#ebdbb2'
  ]),
  t('nord', 'Nord', true, '#2e3440', '#d8dee9', '#d8dee9', '#434c5e', [
    '#3b4252', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#88c0d0', '#e5e9f0',
    '#4c566a', '#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead', '#8fbcbb', '#eceff4'
  ]),
  t('tokyo-night', 'Tokyo Night', true, '#1a1b26', '#c0caf5', '#c0caf5', '#33467c', [
    '#15161e', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#a9b1d6',
    '#414868', '#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7', '#7dcfff', '#c0caf5'
  ]),
  t('monokai', 'Monokai', true, '#272822', '#f8f8f2', '#f8f8f0', '#49483e', [
    '#272822', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f8f8f2',
    '#75715e', '#f92672', '#a6e22e', '#f4bf75', '#66d9ef', '#ae81ff', '#a1efe4', '#f9f8f5'
  ]),
  t('catppuccin-mocha', 'Catppuccin Mocha', true, '#1e1e2e', '#cdd6f4', '#f5e0dc', '#45475a', [
    '#45475a', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#bac2de',
    '#585b70', '#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7', '#94e2d5', '#a6adc8'
  ]),
  // ---------- 浅色 ----------
  t('sshub-light', 'SSHub 浅色', false, '#ffffff', '#24292f', '#24292f', '#b6d3ff', [
    '#24292f', '#cf222e', '#116329', '#9a6700', '#0969da', '#8250df', '#1b7c83', '#6e7781',
    '#57606a', '#a40e26', '#1a7f37', '#7d4e00', '#218bff', '#a475f9', '#3192aa', '#8c959f'
  ]),
  t('solarized-light', 'Solarized 浅色', false, '#fdf6e3', '#657b83', '#586e75', '#eee8d5', [
    '#073642', '#dc322f', '#859900', '#b58900', '#268bd2', '#d33682', '#2aa198', '#eee8d5',
    '#002b36', '#cb4b16', '#586e75', '#657b83', '#839496', '#6c71c4', '#93a1a1', '#fdf6e3'
  ]),
  t('gruvbox-light', 'Gruvbox 浅色', false, '#fbf1c7', '#3c3836', '#3c3836', '#ebdbb2', [
    '#fbf1c7', '#cc241d', '#98971a', '#d79921', '#458588', '#b16286', '#689d6a', '#7c6f64',
    '#928374', '#9d0006', '#79740e', '#b57614', '#076678', '#8f3f71', '#427b58', '#3c3836'
  ]),
  t('one-light', 'One Light', false, '#fafafa', '#383a42', '#526eff', '#e5e5e6', [
    '#383a42', '#e45649', '#50a14f', '#c18401', '#4078f2', '#a626a4', '#0184bc', '#a0a1a7',
    '#696c77', '#e45649', '#50a14f', '#c18401', '#4078f2', '#a626a4', '#0184bc', '#fafafa'
  ]),
  t('catppuccin-latte', 'Catppuccin Latte', false, '#eff1f5', '#4c4f69', '#dc8a78', '#ccd0da', [
    '#5c5f77', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#acb0be',
    '#6c6f85', '#d20f39', '#40a02b', '#df8e1d', '#1e66f5', '#ea76cb', '#179299', '#bcc0cc'
  ])
]

export function getTheme(id: string, fallbackDark: boolean): TermTheme {
  return THEMES.find((x) => x.id === id) ?? THEMES.find((x) => x.id === (fallbackDark ? 'sshub-dark' : 'sshub-light'))!
}

/** #rrggbb → rgba(r,g,b,a) */
function withAlpha(hex: string | undefined, a: number): string | undefined {
  if (!hex || a >= 1) return hex
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i)
  if (!m) return hex
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`
}

/**
 * 当前终端配色（考虑深浅色与背景透明度），并同步到页面：
 * data-theme（界面深浅色）、data-translucent（半透明）、--bg-term（终端背景色）
 */
export function useTerminalTheme(s: AppSettings, isDark: boolean): TermTheme {
  const base = getTheme(isDark ? s.terminalThemeDark : s.terminalThemeLight, isDark)
  const translucent = s.backgroundOpacity < 1
  const theme = useMemo<TermTheme>(
    () =>
      translucent
        ? { ...base, colors: { ...base.colors, background: withAlpha(base.colors.background, s.backgroundOpacity) } }
        : base,
    [base, translucent, s.backgroundOpacity]
  )
  useEffect(() => {
    const root = document.documentElement
    root.dataset.theme = isDark ? 'dark' : 'light'
    if (translucent) root.dataset.translucent = '1'
    else delete root.dataset.translucent
    root.style.setProperty('--bg-term', theme.colors.background ?? '')
  }, [isDark, theme, translucent])
  return theme
}
