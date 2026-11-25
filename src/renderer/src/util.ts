import type { FtpSecurity, Protocol, QuickTarget } from '../../shared/types'

export function formatSize(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '-'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 ? 0 : 1)} ${units[i]}`
}

export function formatTime(ms: number): string {
  if (!ms) return '-'
  const d = new Date(ms)
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/**
 * 解析快速连接地址：
 *   user@host[:port]            → SSH
 *   ssh://… / sftp://…          → SSH
 *   ftp://[user[:pass]@]host[:port]   → FTP
 *   ftps://…                    → 显式 FTPS；ftpes:// 同义；ftps-implicit:// 隐式 FTPS
 */
export function parseQuick(input: string): QuickTarget | null {
  let s = input.trim().replace(/^ssh\s+/, '')
  let protocol: Protocol = 'ssh'
  let security: FtpSecurity = 'none'
  const scheme = s.match(/^([a-z-]+):\/\//i)
  if (scheme) {
    const sc = scheme[1].toLowerCase()
    s = s.slice(scheme[0].length).replace(/\/.*$/, '')
    if (sc === 'ssh' || sc === 'sftp') protocol = 'ssh'
    else if (sc === 'ftp') protocol = 'ftp'
    else if (sc === 'ftps' || sc === 'ftpes') {
      protocol = 'ftp'
      security = 'explicit'
    } else if (sc === 'ftps-implicit') {
      protocol = 'ftp'
      security = 'implicit'
    } else return null
  }
  const m = s.match(/^(?:([^@\s:]+)(?::([^@\s]*))?@)?(\[[^\]]+\]|[^:\s@/]+)(?::(\d+))?$/)
  if (!m) return null
  const defPort = protocol === 'ssh' ? 22 : security === 'implicit' ? 990 : 21
  const username = m[1] ? decodeURIComponent(m[1]) : protocol === 'ftp' ? 'anonymous' : 'root'
  return {
    protocol,
    ftp: protocol === 'ftp' ? { security, ignoreCert: false, anonymous: username === 'anonymous' } : undefined,
    username,
    password: m[2] ? decodeURIComponent(m[2]) : undefined,
    host: m[3].replace(/^\[|\]$/g, ''),
    port: m[4] ? Number(m[4]) : defPort
  }
}

export function posixJoin(dir: string, name: string): string {
  return dir.endsWith('/') ? dir + name : dir + '/' + name
}

export function posixParent(p: string): string {
  if (p === '/' || !p) return '/'
  const s = p.replace(/\/+$/, '')
  const i = s.lastIndexOf('/')
  return i <= 0 ? '/' : s.slice(0, i)
}

let seq = 0
export function uid(): string {
  return `${Date.now().toString(36)}-${(seq++).toString(36)}`
}

const TEXT_EXT = new Set(
  (
    'txt log md markdown rst csv tsv json jsonc json5 xml yaml yml toml ini cfg conf config properties env ' +
    'sh bash zsh fish ksh csh bat cmd ps1 py pyw rb pl pm php phtml js mjs cjs jsx ts tsx vue svelte ' +
    'html htm xhtml css scss sass less java kt kts scala groovy gradle c h cc cpp cxx hpp hh cs go rs swift m mm ' +
    'lua r sql psql dockerfile makefile mk cmake gitignore gitattributes editorconfig htaccess service socket timer ' +
    'tf hcl proto graphql gql nginx vhost crontab pem crt key pub csr ovpn rules lock tex srt vtt diff patch'
  ).split(' ')
)
const TEXT_NAMES = /^(\.?[a-z]*rc|\.profile|\.bash_profile|\.bash_logout|\.env(\..+)?|dockerfile|makefile|gemfile|rakefile|procfile|vagrantfile|jenkinsfile|readme|license|changelog|authors|hosts|crontab|fstab|passwd|group|shadow|sudoers|config|authorized_keys|known_hosts)$/i

/** 根据文件名判断是否适合直接用文本编辑器打开 */
export function isTextFile(name: string, size: number): boolean {
  if (size > 10 * 1024 * 1024) return false
  const lower = name.toLowerCase()
  if (TEXT_NAMES.test(lower)) return true
  const dot = lower.lastIndexOf('.')
  if (dot < 0) return size < 1024 * 1024
  const ext = lower.slice(dot + 1)
  return TEXT_EXT.has(ext) || /^(conf|log|txt|bak|old|orig|sample|dist|example)\.?\d*$/.test(ext)
}

/** Electron 快捷键格式 → macOS 符号，例如 "Control+Shift+`" → "⌃⇧`" */
export function formatAccelerator(acc: string): string {
  const map: Record<string, string> = {
    commandorcontrol: '⌘',
    cmdorctrl: '⌘',
    command: '⌘',
    cmd: '⌘',
    control: '⌃',
    ctrl: '⌃',
    alt: '⌥',
    option: '⌥',
    shift: '⇧',
    super: '⌘',
    space: '空格'
  }
  return acc
    .split('+')
    .map((k) => map[k.toLowerCase()] ?? k)
    .join('')
}
