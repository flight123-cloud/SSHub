import { useEffect, useMemo, useRef, useState } from 'react'
import type { FileEntry } from '../../../shared/types'
import { formatSize, formatTime } from '../util'
import { ContextMenu, type MenuItem } from './ContextMenu'

export type Side = 'local' | 'remote'
export const DRAG_MIME = 'application/x-sshub-files'

type SortKey = 'name' | 'size' | 'mtime'

export interface FilePaneProps {
  side: Side
  title: string
  cwd: string
  entries: FileEntry[]
  loading: boolean
  error?: string
  showHidden: boolean
  onToggleHidden: () => void
  onNavigate: (path: string) => void
  onUp: () => void
  onHome: () => void
  onRefresh: () => void
  onOpen: (e: FileEntry) => void
  /** 从另一侧或 Finder 拖入 */
  onDropFiles: (from: Side | 'finder', paths: string[], targetDir?: string) => void
  buildMenu: (selected: FileEntry[]) => MenuItem[]
  onSelectionChange?: (selected: FileEntry[]) => void
  onDeleteKey?: (selected: FileEntry[]) => void
}

export function FilePane(props: FilePaneProps) {
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [sortAsc, setSortAsc] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [pathInput, setPathInput] = useState(props.cwd)
  const [dragOver, setDragOver] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setPathInput(props.cwd)
    setSelected(new Set())
    setAnchor(null)
  }, [props.cwd])

  const rows = useMemo(() => {
    const list = props.entries.filter((e) => props.showHidden || !e.name.startsWith('.'))
    list.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      let r = 0
      if (sortKey === 'name') r = a.name.localeCompare(b.name, 'zh-CN', { numeric: true })
      else if (sortKey === 'size') r = a.size - b.size
      else r = a.mtime - b.mtime
      return sortAsc ? r : -r
    })
    return list
  }, [props.entries, props.showHidden, sortKey, sortAsc])

  const selectedEntries = rows.filter((r) => selected.has(r.path))

  useEffect(() => {
    props.onSelectionChange?.(selectedEntries)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, rows])

  const clickRow = (e: React.MouseEvent, f: FileEntry): void => {
    const next = new Set(selected)
    if (e.metaKey || e.ctrlKey) {
      if (next.has(f.path)) next.delete(f.path)
      else next.add(f.path)
      setAnchor(f.path)
    } else if (e.shiftKey && anchor) {
      const a = rows.findIndex((r) => r.path === anchor)
      const b = rows.findIndex((r) => r.path === f.path)
      next.clear()
      for (let i = Math.min(a, b); i <= Math.max(a, b); i++) next.add(rows[i].path)
    } else {
      next.clear()
      next.add(f.path)
      setAnchor(f.path)
    }
    setSelected(next)
  }

  const sortBy = (k: SortKey): void => {
    if (sortKey === k) setSortAsc(!sortAsc)
    else {
      setSortKey(k)
      setSortAsc(true)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'a') {
      e.preventDefault()
      setSelected(new Set(rows.map((r) => r.path)))
    } else if (e.key === 'Backspace' && e.metaKey) {
      if (selectedEntries.length) props.onDeleteKey?.(selectedEntries)
    } else if (e.key === 'Delete') {
      if (selectedEntries.length) props.onDeleteKey?.(selectedEntries)
    } else if (e.key === 'Enter' && selectedEntries.length === 1) {
      props.onOpen(selectedEntries[0])
    } else if (e.key === 'ArrowUp' && e.metaKey) {
      props.onUp()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const cur = anchor ? rows.findIndex((r) => r.path === anchor) : -1
      const idx = Math.max(0, Math.min(rows.length - 1, cur + (e.key === 'ArrowDown' ? 1 : -1)))
      if (rows[idx]) {
        setSelected(new Set([rows[idx].path]))
        setAnchor(rows[idx].path)
        listRef.current?.querySelector(`[data-idx="${idx}"]`)?.scrollIntoView({ block: 'nearest' })
      }
    }
  }

  const handleDrop = (e: React.DragEvent, targetDir?: string): void => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
    const internal = e.dataTransfer.getData(DRAG_MIME)
    if (internal) {
      const { side, paths } = JSON.parse(internal) as { side: Side; paths: string[] }
      if (side === props.side && !targetDir) return
      props.onDropFiles(side, paths, targetDir)
      return
    }
    if (e.dataTransfer.files.length) {
      const paths = [...e.dataTransfer.files].map((f) => window.api.local.pathForFile(f)).filter(Boolean)
      if (paths.length) props.onDropFiles('finder', paths, targetDir)
    }
  }

  const sortMark = (k: SortKey): string => (sortKey === k ? (sortAsc ? ' ▲' : ' ▼') : '')

  return (
    <div
      className={'file-pane' + (dragOver ? ' drag-over' : '')}
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
      }}
      onDrop={(e) => handleDrop(e)}
    >
      <div className="pane-head">
        <span className="pane-title">{props.title}</span>
        <button className="icon-btn" title="上级目录" onClick={props.onUp}>
          ↑
        </button>
        <button className="icon-btn" title="主目录" onClick={props.onHome}>
          ⌂
        </button>
        <button className="icon-btn" title="刷新" onClick={props.onRefresh}>
          ⟳
        </button>
        <input
          className="input grow path-input"
          value={pathInput}
          onChange={(e) => setPathInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && props.onNavigate(pathInput.trim())}
          spellCheck={false}
        />
        <button
          className={'icon-btn' + (props.showHidden ? ' on' : '')}
          title="显示隐藏文件"
          onClick={props.onToggleHidden}
        >
          .*
        </button>
      </div>
      <div className="file-table-head">
        <div className="c-name" onClick={() => sortBy('name')}>
          名称{sortMark('name')}
        </div>
        <div className="c-size" onClick={() => sortBy('size')}>
          大小{sortMark('size')}
        </div>
        <div className="c-time" onClick={() => sortBy('mtime')}>
          修改时间{sortMark('mtime')}
        </div>
        <div className="c-perm">权限</div>
      </div>
      <div
        ref={listRef}
        className="file-list"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) setSelected(new Set())
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          if (e.target === e.currentTarget) setSelected(new Set())
          const sel = e.target === e.currentTarget ? [] : selectedEntries
          setMenu({ x: e.clientX, y: e.clientY, items: props.buildMenu(sel) })
        }}
      >
        {props.loading && <div className="pane-msg">加载中…</div>}
        {!props.loading && props.error && <div className="pane-msg error">{props.error}</div>}
        {!props.loading && !props.error && rows.length === 0 && <div className="pane-msg">空目录</div>}
        {!props.error &&
          rows.map((f, i) => (
            <div
              key={f.path}
              data-idx={i}
              className={'file-row' + (selected.has(f.path) ? ' selected' : '')}
              draggable
              onDragStart={(e) => {
                let paths = selectedEntries.map((s) => s.path)
                if (!selected.has(f.path)) {
                  paths = [f.path]
                  setSelected(new Set([f.path]))
                }
                e.dataTransfer.setData(DRAG_MIME, JSON.stringify({ side: props.side, paths }))
                e.dataTransfer.effectAllowed = 'copy'
              }}
              onDragOver={(e) => {
                if (f.isDir) {
                  e.preventDefault()
                  e.currentTarget.classList.add('drop-target')
                }
              }}
              onDragLeave={(e) => e.currentTarget.classList.remove('drop-target')}
              onDrop={(e) => {
                e.currentTarget.classList.remove('drop-target')
                if (f.isDir) handleDrop(e, f.path)
              }}
              onMouseDown={(e) => {
                if (e.button === 0) clickRow(e, f)
                else if (e.button === 2 && !selected.has(f.path)) {
                  setSelected(new Set([f.path]))
                  setAnchor(f.path)
                }
              }}
              onDoubleClick={() => props.onOpen(f)}
            >
              <div className="c-name">
                <span className={'ficon' + (f.isDir ? ' dir' : '')}>{f.isDir ? '📁' : '📄'}</span>
                <span className="fname">{f.name}</span>
                {f.isLink && <span className="link-mark">↪</span>}
              </div>
              <div className="c-size">{f.isDir ? '' : formatSize(f.size)}</div>
              <div className="c-time">{formatTime(f.mtime)}</div>
              <div className="c-perm">{f.perm}</div>
            </div>
          ))}
      </div>
      <div className="pane-foot">
        {rows.length} 项{selectedEntries.length > 0 && `，已选 ${selectedEntries.length} 项`}
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  )
}
