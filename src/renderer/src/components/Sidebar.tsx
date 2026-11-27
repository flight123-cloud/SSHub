import { useMemo, useState } from 'react'
import { k } from '../keys'
import type { SessionInfo } from '../../../shared/types'
import { ContextMenu, type MenuItem } from './ContextMenu'

export function Sidebar(props: {
  sessions: SessionInfo[]
  onConnect: (s: SessionInfo) => void
  onNew: () => void
  onEdit: (s: SessionInfo) => void
  onDuplicate: (s: SessionInfo) => void
  onDelete: (s: SessionInfo) => void
  onQuick: (text: string) => void
}) {
  const [filter, setFilter] = useState('')
  const [quick, setQuick] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)

  const groups = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const list = props.sessions
      .filter(
        (s) =>
          !f ||
          s.name.toLowerCase().includes(f) ||
          s.host.toLowerCase().includes(f) ||
          s.username.toLowerCase().includes(f) ||
          s.group.toLowerCase().includes(f)
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
    const map = new Map<string, SessionInfo[]>()
    for (const s of list) {
      const g = s.group || ''
      if (!map.has(g)) map.set(g, [])
      map.get(g)!.push(s)
    }
    return [...map.entries()].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : a.localeCompare(b, 'zh-CN')))
  }, [props.sessions, filter])

  const openMenu = (e: React.MouseEvent, s: SessionInfo): void => {
    e.preventDefault()
    setSelected(s.id)
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: '连接', onClick: () => props.onConnect(s) },
        { type: 'separator' },
        { label: '编辑…', onClick: () => props.onEdit(s) },
        { label: '复制会话', onClick: () => props.onDuplicate(s) },
        { label: '复制地址', onClick: () => void window.api.ui.copyText(`${s.username}@${s.host}`) },
        { type: 'separator' },
        { label: '删除', danger: true, onClick: () => props.onDelete(s) }
      ]
    })
  }

  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <input
          className="input full"
          placeholder="快速连接：user@host 或 ftp://host"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && quick.trim()) {
              props.onQuick(quick)
              setQuick('')
            }
          }}
          data-quick-connect
        />
        <div className="row">
          <input
            className="input grow"
            placeholder="搜索会话"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button className="icon-btn" title={`新建会话 (${k('new-session')})`} onClick={props.onNew}>
            ＋
          </button>
        </div>
      </div>
      <div
        className="session-list"
        tabIndex={0}
        onKeyDown={(e) => {
          const flat = groups.flatMap(([g, l]) => (collapsed[g] ? [] : l))
          const i = flat.findIndex((x) => x.id === selected)
          if (e.key === 'Enter' && i >= 0) props.onConnect(flat[i])
          else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            const n = Math.max(0, Math.min(flat.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
            if (flat[n]) setSelected(flat[n].id)
          }
        }}
      >
        {props.sessions.length === 0 && (
          <div className="empty-hint">
            还没有保存的服务器
            <br />
            <button className="link" onClick={props.onNew}>
              新建会话
            </button>
            <div className="small">保存后会出现在这里，双击即可连接</div>
          </div>
        )}
        {groups.map(([g, list]) => (
          <div key={g || '__none'}>
            {(g || groups.length > 1) && (
              <div className="group-title" onClick={() => setCollapsed({ ...collapsed, [g]: !collapsed[g] })}>
                <span className="caret">{collapsed[g] ? '▸' : '▾'}</span>
                {g || '未分组'}
                <span className="count">{list.length}</span>
              </div>
            )}
            {!collapsed[g] &&
              list.map((s) => (
                <div
                  key={s.id}
                  className={'session-item' + (selected === s.id ? ' selected' : '')}
                  onClick={() => setSelected(s.id)}
                  onDoubleClick={() => props.onConnect(s)}
                  onContextMenu={(e) => openMenu(e, s)}
                  title={`${s.protocol === 'ftp' ? 'FTP' : 'SSH'} ${s.username}@${s.host}:${s.port}\n双击或按 Enter 连接`}
                >
                  <div className={'session-icon ' + s.protocol}>{s.protocol === 'ftp' ? 'FTP' : 'SSH'}</div>
                  <div className="session-text">
                    <div className="session-name">{s.name}</div>
                    <div className="session-sub">
                      {s.username}@{s.host}
                      {s.port !== (s.protocol === 'ftp' ? 21 : 22) ? `:${s.port}` : ''}
                    </div>
                  </div>
                  <button
                    className="connect-btn"
                    title="连接"
                    onClick={(e) => {
                      e.stopPropagation()
                      props.onConnect(s)
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    连接
                  </button>
                </div>
              ))}
          </div>
        ))}
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
