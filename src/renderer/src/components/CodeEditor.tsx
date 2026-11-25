import { useEffect, useRef, useState } from 'react'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
  drawSelection,
  highlightSpecialChars,
  rectangularSelection,
  crosshairCursor,
  dropCursor
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { searchKeymap, highlightSelectionMatches, openSearchPanel, gotoLine } from '@codemirror/search'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  syntaxHighlighting,
  defaultHighlightStyle,
  LanguageDescription
} from '@codemirror/language'
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { ENCODING_LABELS, type Encoding, type TextFile } from '../../../shared/types'
import { onCommand } from '../bus'
import { errMsg, formatSize } from '../util'

/** 搜索面板等内置文案的中文翻译 */
const PHRASES = EditorState.phrases.of({
  Find: '查找',
  Replace: '替换',
  next: '下一个',
  previous: '上一个',
  all: '全部',
  'match case': '区分大小写',
  regexp: '正则',
  'by word': '全词匹配',
  replace: '替换',
  'replace all': '全部替换',
  close: '关闭',
  'current match': '当前匹配',
  'replaced $ matches': '已替换 $ 处',
  'replaced match on line $': '已替换第 $ 行的匹配',
  'on line': '行',
  'Go to line': '跳转到行',
  go: '跳转',
  'Folded lines': '已折叠的行',
  'Unfolded lines': '已展开的行',
  'Fold line': '折叠',
  'Unfold line': '展开'
})

/** 常见的无扩展名配置文件 */
function pickLanguage(name: string): LanguageDescription | null {
  const lower = name.toLowerCase()
  if (/^\.(bash|zsh)(rc|_profile|_logout)?$|^\.profile$|^\.?env(rc)?$|\.env(\..+)?$/.test(lower))
    return LanguageDescription.matchLanguageName(languages, 'shell')
  if (/^(nginx\.conf|.+\.nginx)$/.test(lower) || lower.endsWith('.conf'))
    return (
      LanguageDescription.matchLanguageName(languages, lower.includes('nginx') ? 'nginx' : 'properties') ??
      null
    )
  if (/^(makefile|gnumakefile)$/.test(lower)) return LanguageDescription.matchLanguageName(languages, 'cmake')
  if (/(^|\.)(crontab|hosts|fstab)$/.test(lower)) return LanguageDescription.matchLanguageName(languages, 'properties')
  return LanguageDescription.matchFilename(languages, name)
}

export interface CodeEditorProps {
  connId: string
  path: string
  onClose: () => void
  onSaved: () => void
  notify: (msg: string, error?: boolean) => void
}

export function CodeEditor(props: CodeEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const langComp = useRef(new Compartment())
  const wrapComp = useRef(new Compartment())
  const savedDoc = useRef('')
  const [file, setFile] = useState<TextFile | null>(null)
  const [encoding, setEncoding] = useState<Encoding>('utf8')
  const [eol, setEol] = useState<'lf' | 'crlf'>('lf')
  const [dirty, setDirty] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [wrap, setWrap] = useState(false)
  const [cursor, setCursor] = useState({ line: 1, col: 1 })
  const [lang, setLang] = useState('纯文本')
  const name = props.path.split('/').pop() || props.path
  const propsRef = useRef(props)
  propsRef.current = props
  const saveRef = useRef<() => Promise<void>>(async () => undefined)
  const closeRef = useRef<() => Promise<void>>(async () => undefined)

  const load = async (want?: Encoding): Promise<void> => {
    try {
      const f = await window.api.remote.openText(props.connId, props.path, want)
      setFile(f)
      setEncoding(f.encoding)
      setEol(f.eol)
      setLoadError('')
      const v = viewRef.current
      // CodeMirror 内部统一用 \n；保存时按原换行符写回
      const doc = f.text.replace(/\r\n/g, '\n')
      savedDoc.current = doc
      if (v) {
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: doc } })
        setDirty(false)
      } else createView(doc)
    } catch (e) {
      setLoadError(errMsg(e))
    }
  }

  const createView = (doc: string): void => {
    const updateListener = EditorView.updateListener.of((u) => {
      if (u.docChanged) setDirty(u.state.doc.toString() !== savedDoc.current)
      if (u.selectionSet || u.docChanged) {
        const pos = u.state.selection.main.head
        const line = u.state.doc.lineAt(pos)
        setCursor({ line: line.number, col: pos - line.from + 1 })
      }
    })
    const extensions: Extension[] = [
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      dropCursor(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      bracketMatching(),
      closeBrackets(),
      rectangularSelection(),
      crosshairCursor(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        { key: 'Mod-g', run: gotoLine },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab
      ]),
      oneDark,
      PHRASES,
      langComp.current.of([]),
      wrapComp.current.of([]),
      updateListener,
      EditorView.theme({
        '&': { height: '100%', fontSize: '13px' },
        '.cm-scroller': { fontFamily: '"SF Mono", Menlo, Monaco, "PingFang SC", monospace' }
      })
    ]
    const view = new EditorView({ state: EditorState.create({ doc, extensions }), parent: hostRef.current! })
    viewRef.current = view
    view.focus()
    // 按文件名异步加载语法高亮
    const desc = pickLanguage(name)
    if (desc) {
      void desc.load().then((support) => {
        view.dispatch({ effects: langComp.current.reconfigure(support) })
        setLang(desc.name)
      })
    }
  }

  useEffect(() => {
    void load()
    return () => viewRef.current?.destroy()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    viewRef.current?.dispatch({ effects: wrapComp.current.reconfigure(wrap ? EditorView.lineWrapping : []) })
  }, [wrap])

  const save = async (): Promise<void> => {
    const v = viewRef.current
    if (!v || saving) return
    setSaving(true)
    try {
      const doc = v.state.doc.toString()
      const text = eol === 'crlf' ? doc.replace(/\n/g, '\r\n') : doc
      await window.api.remote.saveText(props.connId, props.path, text, encoding, file?.bom ?? false)
      savedDoc.current = doc
      setDirty(false)
      propsRef.current.notify('已保存 ' + props.path)
      propsRef.current.onSaved()
    } catch (e) {
      propsRef.current.notify('保存失败：' + errMsg(e), true)
    }
    setSaving(false)
  }
  saveRef.current = save

  const close = async (): Promise<void> => {
    if (dirty && !(await window.api.ui.confirm('文件有未保存的修改，确定要关闭吗？', '未保存的修改会丢失。'))) return
    propsRef.current.onClose()
  }
  closeRef.current = close

  // 焦点在查找 / 替换输入框等编辑区以外的位置时，⌘S 也能保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ⌘W 关闭编辑器（而不是关闭整个连接标签页）
  useEffect(() => onCommand((cmd) => cmd === 'close-editor' && void closeRef.current()), [])

  const changeEncoding = async (enc: Encoding): Promise<void> => {
    if (dirty) {
      // 有修改：只改变保存时使用的编码
      setEncoding(enc)
      propsRef.current.notify(`保存时将使用 ${ENCODING_LABELS[enc]} 编码`)
    } else {
      // 没有修改：按新编码重新解码文件
      await load(enc)
    }
  }

  return (
    <div className="modal-mask">
      <div className="modal editor">
        <div className="editor-head">
          <span className="editor-title" title={props.path}>
            {dirty && <span className="dirty-dot">●</span>}
            {name}
            <span className="muted small editor-path">{props.path}</span>
          </span>
          <button className="icon-btn" title="查找 / 替换 (⌘F)" onClick={() => viewRef.current && openSearchPanel(viewRef.current)}>
            查找
          </button>
          <button className="icon-btn" title="跳转到行 (⌘G)" onClick={() => viewRef.current && gotoLine(viewRef.current)}>
            跳转
          </button>
          <button className={'icon-btn' + (wrap ? ' on' : '')} title="自动换行" onClick={() => setWrap(!wrap)}>
            换行
          </button>
          <button onClick={() => void close()}>关闭</button>
          <button className="primary" disabled={saving || !dirty || !file} onClick={() => void save()}>
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
        <div className="editor-body">
          {loadError ? (
            <div className="pane-msg error">
              无法打开：{loadError}
              <div style={{ marginTop: 12 }}>
                <button onClick={() => void load()}>重试</button>
              </div>
            </div>
          ) : (
            <div ref={hostRef} className="cm-host" />
          )}
        </div>
        <div className="editor-status">
          <span>
            行 {cursor.line}，列 {cursor.col}
          </span>
          <span>{lang}</span>
          <label title="没有修改时：按所选编码重新读取文件；有修改时：保存时转换为所选编码">
            编码
            <select className="mini-select" value={encoding} onChange={(e) => void changeEncoding(e.target.value as Encoding)}>
              {(Object.keys(ENCODING_LABELS) as Encoding[]).map((k) => (
                <option key={k} value={k}>
                  {ENCODING_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          <label title="保存时使用的换行符">
            换行符
            <select className="mini-select" value={eol} onChange={(e) => setEol(e.target.value as 'lf' | 'crlf')}>
              <option value="lf">LF（Linux / macOS）</option>
              <option value="crlf">CRLF（Windows）</option>
            </select>
          </label>
          {file?.bom && <span>BOM</span>}
          {file && <span>{formatSize(file.size)}</span>}
          <span className="grow" />
          <span className="muted">⌘S 保存 · ⌘F 查找替换 · ⌘G 跳转到行 · ⌘W 关闭</span>
        </div>
      </div>
    </div>
  )
}
