import { useRef, type ReactNode } from 'react'
import { layout, type PaneNode } from '../panes'

/**
 * 分屏容器：所有面板按创建顺序平铺渲染，用绝对定位摆放，
 * 布局变化时面板组件不会被重新创建（终端和连接都保留）。
 */
export function SplitView(props: {
  tree: PaneNode
  /** 面板创建顺序（渲染顺序固定，避免 DOM 节点被移动） */
  order: string[]
  focused: string
  zoomed: string | null
  dimUnfocused: boolean
  renderPane: (id: string) => ReactNode
  onFocus: (id: string) => void
  onRatio: (splitId: string, ratio: number) => void
}) {
  const boxRef = useRef<HTMLDivElement>(null)
  const { panes, dividers } = layout(props.tree)
  const multi = panes.size > 1

  const startDrag = (e: React.MouseEvent, d: (typeof dividers)[number]): void => {
    e.preventDefault()
    const box = boxRef.current?.getBoundingClientRect()
    if (!box) return
    document.body.classList.add(d.dir === 'row' ? 'dragging-col' : 'dragging-row')
    const move = (ev: MouseEvent): void => {
      if (d.dir === 'row') {
        const x = ((ev.clientX - box.left) / box.width) * 100
        props.onRatio(d.splitId, (x - d.area.x) / d.area.w)
      } else {
        const y = ((ev.clientY - box.top) / box.height) * 100
        props.onRatio(d.splitId, (y - d.area.y) / d.area.h)
      }
    }
    const up = (): void => {
      document.body.classList.remove('dragging-col', 'dragging-row')
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  return (
    <div ref={boxRef} className="split-view">
      {props.order
        .filter((id) => panes.has(id))
        .map((id) => {
          const r = props.zoomed === id ? { x: 0, y: 0, w: 100, h: 100 } : panes.get(id)!
          const hidden = props.zoomed !== null && props.zoomed !== id
          const focused = id === props.focused
          return (
            <div
              key={id}
              data-pane={id}
              className={'split-pane' + (multi && focused ? ' focused' : '')}
              style={{
                left: r.x + '%',
                top: r.y + '%',
                width: r.w + '%',
                height: r.h + '%',
                display: hidden ? 'none' : 'flex'
              }}
              onMouseDownCapture={() => !focused && props.onFocus(id)}
            >
              {props.renderPane(id)}
              {multi && !focused && props.dimUnfocused && !props.zoomed && <div className="split-dim" />}
            </div>
          )
        })}
      {!props.zoomed &&
        dividers.map((d) => (
          <div
            key={d.splitId}
            className={'split-divider ' + (d.dir === 'row' ? 'vertical' : 'horizontal')}
            style={
              d.dir === 'row'
                ? { left: d.rect.x + '%', top: d.rect.y + '%', height: d.rect.h + '%' }
                : { left: d.rect.x + '%', top: d.rect.y + '%', width: d.rect.w + '%' }
            }
            onMouseDown={(e) => startDrag(e, d)}
          />
        ))}
      {props.zoomed && multi && <div className="zoom-badge">已放大 · ⌘⇧Enter 还原</div>}
    </div>
  )
}
