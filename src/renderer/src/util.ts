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

/** 解析 user@host:port */
export function parseQuick(s: string): { username: string; host: string; port: number } | null {
  const m = s.trim().match(/^(?:ssh\s+)?(?:([^@\s]+)@)?(\[[^\]]+\]|[^:\s]+)(?::(\d+))?$/)
  if (!m) return null
  return {
    username: m[1] || 'root',
    host: m[2].replace(/^\[|\]$/g, ''),
    port: m[3] ? Number(m[3]) : 22
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
