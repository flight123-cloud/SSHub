import { useEffect, useMemo, useRef, useState } from 'react'

export interface PaletteItem {
  id: string
  group: string
  label: string
  /** 副标题，例如 user@host */
  hint?: string
  /** 右侧快捷键提示 */
  shortcut?: string
  /** 额外的搜索关键字 */
  keywords?: string
  run: () => void
}

/**
 * 打分：所有空格分隔的关键字都要出现；
 * 前缀匹配 > 单词开头匹配 > 包含 > 子序列（如 "pdb" 匹配 "prod-db"）
 */
function score(item: PaletteItem, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const label = item.label.toLowerCase()
  const hay = `${label} ${(item.hint ?? '').toLowerCase()} ${(item.keywords ?? '').toLowerCase()}`
  let total = 0
  for (const tok of q.split(/\s+/)) {
    if (label.startsWith(tok)) total += 100
    else if (new RegExp('(^|[\\s@._/:-])' + tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(hay)) total += 60
    else if (hay.includes(tok)) total += 30
    else {
      // 子序列匹配
      let i = 0
      for (const ch of hay) if (ch === tok[i]) i++
      if (i < tok.length) return 0
      total += 10
    }
  }
  return total
}

export function CommandPalette(props: { items: PaletteItem[]; placeholder: string; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(() => {
    const scored = props.items.map((it, i) => ({ it, s: score(it, query), i })).filter((x) => x.s > 0)
    // 有查询时按分数排序，否则保持原顺序（分组）
    if (query.trim()) scored.sort((a, b) => b.s - a.s || a.i - b.i)
    return scored.map((x) => x.it).slice(0, 80)
  }, [props.items, query])

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = (it: PaletteItem | undefined): void => {
    if (!it) return
    props.onClose()
    // 等面板关闭后再执行，避免焦点被抢
    setTimeout(it.run, 0)
  }

  let lastGroup = ''
  return (
    <div className="modal-mask palette-mask" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="palette">
        <input
          className="palette-input"
          autoFocus
          placeholder={props.placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(results.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              run(results[index])
            } else if (e.key === 'Escape') props.onClose()
          }}
        />
        <div className="palette-list" ref={listRef}>
          {results.length === 0 && <div className="palette-empty">没有匹配的结果</div>}
          {results.map((it, i) => {
            const showGroup = !query.trim() && it.group !== lastGroup
            lastGroup = it.group
            return (
              <div key={it.id}>
                {showGroup && <div className="palette-group">{it.group}</div>}
                <div
                  data-idx={i}
                  className={'palette-item' + (i === index ? ' active' : '')}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => run(it)}
                >
                  <span className="palette-label">{it.label}</span>
                  {it.hint && <span className="palette-hint">{it.hint}</span>}
                  <span className="grow" />
                  {query.trim() && <span className="palette-tag">{it.group}</span>}
                  {it.shortcut && <kbd>{it.shortcut}</kbd>}
                </div>
              </div>
            )
          })}
        </div>
        <div className="palette-foot">↑↓ 选择 · Enter 执行 · Esc 关闭</div>
      </div>
    </div>
  )
}
