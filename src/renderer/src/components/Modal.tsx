import { useEffect, useRef, useState, type ReactNode } from 'react'

export function Modal(props: {
  title: string
  children: ReactNode
  onClose: () => void
  footer?: ReactNode
  width?: number
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') props.onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.onClose])
  return (
    <div className="modal-mask" onMouseDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div className="modal" style={{ width: props.width ?? 460 }}>
        <div className="modal-title">{props.title}</div>
        <div className="modal-body">{props.children}</div>
        {props.footer && <div className="modal-footer">{props.footer}</div>}
      </div>
    </div>
  )
}

export interface PromptOptions {
  title: string
  label?: string
  defaultValue?: string
  password?: boolean
  checkbox?: string
  okText?: string
}

export function PromptDialog(props: {
  opts: PromptOptions
  onDone: (value: string | null, checked: boolean) => void
}) {
  const { opts } = props
  const [value, setValue] = useState(opts.defaultValue ?? '')
  const [checked, setChecked] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    if (opts.defaultValue) {
      const dot = opts.defaultValue.lastIndexOf('.')
      ref.current?.setSelectionRange(0, dot > 0 ? dot : opts.defaultValue.length)
    }
  }, [])
  const submit = (): void => props.onDone(value, checked)
  return (
    <Modal
      title={opts.title}
      onClose={() => props.onDone(null, false)}
      footer={
        <>
          <button onClick={() => props.onDone(null, false)}>取消</button>
          <button className="primary" onClick={submit}>
            {opts.okText ?? '确定'}
          </button>
        </>
      }
    >
      {opts.label && <div className="field-label">{opts.label}</div>}
      <input
        ref={ref}
        className="input full"
        type={opts.password ? 'password' : 'text'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {opts.checkbox && (
        <label className="checkbox">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          {opts.checkbox}
        </label>
      )}
    </Modal>
  )
}
