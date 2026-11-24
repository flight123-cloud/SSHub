import { useEffect, useState } from 'react'
import { errMsg } from '../util'

export function TextEditor(props: {
  path: string
  initial: string
  onSave: (content: string) => Promise<void>
  onClose: () => void
}) {
  const [text, setText] = useState(props.initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dirty = text !== props.initial

  const save = async (): Promise<void> => {
    setSaving(true)
    setError('')
    try {
      await props.onSave(text)
      props.onClose()
    } catch (e) {
      setError(errMsg(e))
    }
    setSaving(false)
  }

  const close = async (): Promise<void> => {
    if (dirty && !(await window.api.ui.confirm('放弃未保存的修改？'))) return
    props.onClose()
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void save()
      }
      if (e.key === 'Escape') void close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="modal-mask">
      <div className="modal editor">
        <div className="modal-title">
          编辑：{props.path}
          {dirty && <span className="muted"> （已修改）</span>}
        </div>
        <textarea
          className="editor-area"
          value={text}
          spellCheck={false}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Tab') {
              e.preventDefault()
              const t = e.currentTarget
              const s = t.selectionStart
              const v = t.value
              setText(v.slice(0, s) + '  ' + v.slice(t.selectionEnd))
              requestAnimationFrame(() => t.setSelectionRange(s + 2, s + 2))
            }
          }}
        />
        <div className="modal-footer">
          {error && <span className="form-error">{error}</span>}
          <span className="muted small grow">⌘S 保存 · Esc 关闭</span>
          <button onClick={() => void close()}>关闭</button>
          <button className="primary" disabled={saving || !dirty} onClick={() => void save()}>
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
