import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuItem =
  | { type?: 'item'; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }
  | { type: 'separator' }

export function ContextMenu(props: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: props.x, y: props.y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      x: Math.min(props.x, window.innerWidth - r.width - 4),
      y: Math.min(props.y, window.innerHeight - r.height - 4)
    })
  }, [props.x, props.y])

  useEffect(() => {
    const close = (e: Event): void => {
      if (ref.current && e.target instanceof Node && ref.current.contains(e.target)) return
      props.onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('mousedown', close, true)
    window.addEventListener('blur', props.onClose)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close, true)
      window.removeEventListener('blur', props.onClose)
      window.removeEventListener('keydown', onKey)
    }
  }, [props.onClose])

  return (
    <div ref={ref} className="context-menu" style={{ left: pos.x, top: pos.y }}>
      {props.items.map((it, i) =>
        it.type === 'separator' ? (
          <div key={i} className="menu-sep" />
        ) : (
          <div
            key={i}
            className={'menu-item' + (it.disabled ? ' disabled' : '') + (it.danger ? ' danger' : '')}
            onClick={() => {
              if (it.disabled) return
              props.onClose()
              it.onClick()
            }}
          >
            {it.label}
          </div>
        )
      )}
    </div>
  )
}
