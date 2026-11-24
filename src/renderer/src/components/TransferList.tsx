import { useState } from 'react'
import type { TransferItem } from '../../../shared/types'
import { formatSize } from '../util'

const STATUS: Record<TransferItem['status'], string> = {
  queued: '等待中',
  running: '传输中',
  done: '完成',
  error: '失败',
  canceled: '已取消'
}

export function TransferList(props: { items: TransferItem[]; onCancel: (id: string) => void; onClear: () => void }) {
  const [open, setOpen] = useState(true)
  const active = props.items.filter((t) => t.status === 'queued' || t.status === 'running').length
  const items = [...props.items].reverse()
  return (
    <div className={'transfers' + (open ? ' open' : '')}>
      <div className="transfers-head" onClick={() => setOpen(!open)}>
        <span className="caret">{open ? '▾' : '▸'}</span>
        传输队列
        {active > 0 && <span className="badge">{active}</span>}
        <span className="grow" />
        {props.items.length > 0 && (
          <button
            className="link"
            onClick={(e) => {
              e.stopPropagation()
              props.onClear()
            }}
          >
            清除已完成
          </button>
        )}
      </div>
      {open && (
        <div className="transfers-list">
          {items.length === 0 && <div className="pane-msg">拖拽文件到对侧面板，或双击文件即可传输</div>}
          {items.map((t) => {
            const pct = t.total > 0 ? Math.min(100, (t.transferred / t.total) * 100) : t.status === 'done' ? 100 : 0
            return (
              <div key={t.id} className={'transfer-row ' + t.status}>
                <span className="dir">{t.direction === 'upload' ? '↑' : '↓'}</span>
                <span className="tname" title={`${t.src}\n→ ${t.dest}`}>
                  {t.name}
                </span>
                <div className="progress">
                  <div className="bar" style={{ width: pct + '%' }} />
                </div>
                <span className="tsize">
                  {formatSize(t.transferred)} / {formatSize(t.total)}
                </span>
                <span className="tspeed">{t.status === 'running' && t.speed ? formatSize(t.speed) + '/s' : ''}</span>
                <span className="tstatus" title={t.error}>
                  {t.status === 'error' ? `失败：${t.error}` : STATUS[t.status]}
                </span>
                {(t.status === 'queued' || t.status === 'running') && (
                  <button className="icon-btn" title="取消" onClick={() => props.onCancel(t.id)}>
                    ✕
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
