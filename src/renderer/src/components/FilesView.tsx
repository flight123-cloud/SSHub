import { useCallback, useEffect, useRef, useState } from 'react'
import type { FileEntry, TransferItem } from '../../../shared/types'
import { onTransfer } from '../bus'
import { errMsg, posixJoin, posixParent } from '../util'
import type { MenuItem } from './ContextMenu'
import { FilePane, type Side } from './FilePane'
import { PromptDialog, type PromptOptions } from './Modal'
import { TransferList } from './TransferList'
import { TextEditor } from './TextEditor'

interface PaneState {
  cwd: string
  entries: FileEntry[]
  loading: boolean
  error?: string
}

let lastLocalDir: string | null = null

export function FilesView(props: { connId: string; homeDir: string; active: boolean; notify: (msg: string, error?: boolean) => void }) {
  const { connId, notify } = props
  const [local, setLocal] = useState<PaneState>({ cwd: '', entries: [], loading: true })
  const [remote, setRemote] = useState<PaneState>({ cwd: props.homeDir, entries: [], loading: true })
  const [localHome, setLocalHome] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [transfers, setTransfers] = useState<TransferItem[]>([])
  const [prompt, setPrompt] = useState<{ opts: PromptOptions; resolve: (v: string | null) => void } | null>(null)
  const [editing, setEditing] = useState<{ path: string; content: string } | null>(null)
  const [localSel, setLocalSel] = useState<FileEntry[]>([])
  const [remoteSel, setRemoteSel] = useState<FileEntry[]>([])
  const localRef = useRef(local)
  const remoteRef = useRef(remote)
  localRef.current = local
  remoteRef.current = remote

  const ask = (opts: PromptOptions): Promise<string | null> =>
    new Promise((resolve) => setPrompt({ opts, resolve }))

  const loadLocal = useCallback(async (dir: string): Promise<void> => {
    setLocal((s) => ({ ...s, cwd: dir, loading: true, error: undefined }))
    try {
      const entries = await window.api.local.list(dir)
      lastLocalDir = dir
      setLocal({ cwd: dir, entries, loading: false })
    } catch (e) {
      setLocal({ cwd: dir, entries: [], loading: false, error: errMsg(e) })
    }
  }, [])

  const loadRemote = useCallback(
    async (dir: string): Promise<void> => {
      setRemote((s) => ({ ...s, cwd: dir, loading: true, error: undefined }))
      try {
        const real = await window.api.sftp.realpath(connId, dir || '.')
        const entries = await window.api.sftp.list(connId, real)
        setRemote({ cwd: real, entries, loading: false })
      } catch (e) {
        setRemote({ cwd: dir, entries: [], loading: false, error: errMsg(e) })
      }
    },
    [connId]
  )

  useEffect(() => {
    void window.api.local.home().then((h) => {
      setLocalHome(h)
      void loadLocal(lastLocalDir || h)
    })
    void loadRemote(props.homeDir || '.')
  }, [connId])

  // 传输进度 & 完成后刷新
  useEffect(
    () =>
      onTransfer((t) => {
        if (t.connId !== connId) return
        setTransfers((list) => {
          const i = list.findIndex((x) => x.id === t.id)
          if (i < 0) return [...list, t]
          const next = list.slice()
          next[i] = t
          return next
        })
        if (t.status === 'done') {
          if (t.direction === 'upload') {
            if (posixParent(t.dest) === remoteRef.current.cwd) void loadRemote(remoteRef.current.cwd)
          } else if (posixParent(t.dest) === localRef.current.cwd) void loadLocal(localRef.current.cwd)
        }
        if (t.status === 'error') notify(`${t.name} 传输失败：${t.error}`, true)
      }),
    [connId]
  )

  const upload = async (paths: string[], targetDir?: string): Promise<void> => {
    if (!paths.length) return
    try {
      await window.api.transfer.enqueue(connId, 'upload', paths, targetDir ?? remote.cwd)
    } catch (e) {
      notify(errMsg(e), true)
    }
  }
  const download = async (paths: string[], targetDir?: string): Promise<void> => {
    if (!paths.length) return
    try {
      await window.api.transfer.enqueue(connId, 'download', paths, targetDir ?? local.cwd)
    } catch (e) {
      notify(errMsg(e), true)
    }
  }

  /* ---------- 远程操作 ---------- */
  const remoteMkdir = async (): Promise<void> => {
    const name = await ask({ title: '新建文件夹', label: '名称', defaultValue: '新建文件夹' })
    if (!name) return
    try {
      await window.api.sftp.mkdir(connId, posixJoin(remote.cwd, name))
      void loadRemote(remote.cwd)
    } catch (e) {
      notify(errMsg(e), true)
    }
  }
  const remoteNewFile = async (): Promise<void> => {
    const name = await ask({ title: '新建文件', label: '文件名', defaultValue: 'untitled.txt' })
    if (!name) return
    try {
      await window.api.sftp.writeText(connId, posixJoin(remote.cwd, name), '')
      void loadRemote(remote.cwd)
    } catch (e) {
      notify(errMsg(e), true)
    }
  }
  const remoteRename = async (f: FileEntry): Promise<void> => {
    const name = await ask({ title: '重命名', label: '新名称', defaultValue: f.name })
    if (!name || name === f.name) return
    try {
      await window.api.sftp.rename(connId, f.path, posixJoin(posixParent(f.path), name))
      void loadRemote(remote.cwd)
    } catch (e) {
      notify(errMsg(e), true)
    }
  }
  const remoteDelete = async (list: FileEntry[]): Promise<void> => {
    if (!list.length) return
    const ok = await window.api.ui.confirm(
      `确定要删除选中的 ${list.length} 项吗？`,
      list.slice(0, 8).map((f) => f.name).join('\n') + (list.length > 8 ? '\n…' : '') + '\n\n远程删除无法恢复，文件夹将被递归删除。'
    )
    if (!ok) return
    try {
      await window.api.sftp.remove(connId, list.map((f) => f.path))
      notify(`已删除 ${list.length} 项`)
    } catch (e) {
      notify(errMsg(e), true)
    }
    void loadRemote(remote.cwd)
  }
  const remoteChmod = async (f: FileEntry): Promise<void> => {
    const cur = (f.mode & 0o777).toString(8).padStart(3, '0')
    const v = await ask({ title: '修改权限', label: `${f.name}（八进制，例如 755、644）`, defaultValue: cur })
    if (!v) return
    if (!/^[0-7]{3,4}$/.test(v)) return notify('权限格式不正确', true)
    try {
      await window.api.sftp.chmod(connId, f.path, parseInt(v, 8))
      void loadRemote(remote.cwd)
    } catch (e) {
      notify(errMsg(e), true)
    }
  }
  const remoteEdit = async (f: FileEntry): Promise<void> => {
    try {
      const content = await window.api.sftp.readText(connId, f.path)
      setEditing({ path: f.path, content })
    } catch (e) {
      notify(errMsg(e), true)
    }
  }

  const remoteMenu = (sel: FileEntry[]): MenuItem[] => {
    const one = sel.length === 1 ? sel[0] : null
    const items: MenuItem[] = []
    if (sel.length) {
      items.push({ label: `下载到本地（${sel.length} 项）`, onClick: () => void download(sel.map((s) => s.path)) })
      if (one && !one.isDir) items.push({ label: '编辑', onClick: () => void remoteEdit(one) })
      if (one?.isDir) items.push({ label: '打开', onClick: () => void loadRemote(one.path) })
      items.push({ type: 'separator' })
      if (one) items.push({ label: '重命名…', onClick: () => void remoteRename(one) })
      if (one) items.push({ label: '修改权限…', onClick: () => void remoteChmod(one) })
      items.push({ label: '复制路径', onClick: () => void window.api.ui.copyText(sel.map((s) => s.path).join('\n')) })
      items.push({ label: '删除', danger: true, onClick: () => void remoteDelete(sel) })
      items.push({ type: 'separator' })
    }
    items.push({ label: '新建文件夹…', onClick: () => void remoteMkdir() })
    items.push({ label: '新建文件…', onClick: () => void remoteNewFile() })
    items.push({ label: '刷新', onClick: () => void loadRemote(remote.cwd) })
    return items
  }

  /* ---------- 本地操作 ---------- */
  const localMkdir = async (): Promise<void> => {
    const name = await ask({ title: '新建文件夹', label: '名称', defaultValue: '新建文件夹' })
    if (!name) return
    try {
      await window.api.local.mkdir(posixJoin(local.cwd, name))
      void loadLocal(local.cwd)
    } catch (e) {
      notify(errMsg(e), true)
    }
  }
  const localRename = async (f: FileEntry): Promise<void> => {
    const name = await ask({ title: '重命名', label: '新名称', defaultValue: f.name })
    if (!name || name === f.name) return
    try {
      await window.api.local.rename(f.path, posixJoin(posixParent(f.path), name))
      void loadLocal(local.cwd)
    } catch (e) {
      notify(errMsg(e), true)
    }
  }
  const localTrash = async (list: FileEntry[]): Promise<void> => {
    if (!list.length) return
    const ok = await window.api.ui.confirm(`将选中的 ${list.length} 项移到废纸篓？`)
    if (!ok) return
    try {
      await window.api.local.trash(list.map((f) => f.path))
    } catch (e) {
      notify(errMsg(e), true)
    }
    void loadLocal(local.cwd)
  }
  const localMenu = (sel: FileEntry[]): MenuItem[] => {
    const one = sel.length === 1 ? sel[0] : null
    const items: MenuItem[] = []
    if (sel.length) {
      items.push({ label: `上传到服务器（${sel.length} 项）`, onClick: () => void upload(sel.map((s) => s.path)) })
      if (one && !one.isDir) items.push({ label: '用默认应用打开', onClick: () => void window.api.local.open(one.path) })
      if (one?.isDir) items.push({ label: '打开', onClick: () => void loadLocal(one.path) })
      items.push({ type: 'separator' })
      if (one) items.push({ label: '重命名…', onClick: () => void localRename(one) })
      if (one) items.push({ label: '在 Finder 中显示', onClick: () => void window.api.local.reveal(one.path) })
      items.push({ label: '复制路径', onClick: () => void window.api.ui.copyText(sel.map((s) => s.path).join('\n')) })
      items.push({ label: '移到废纸篓', danger: true, onClick: () => void localTrash(sel) })
      items.push({ type: 'separator' })
    }
    items.push({ label: '新建文件夹…', onClick: () => void localMkdir() })
    items.push({ label: '在 Finder 中打开当前目录', onClick: () => void window.api.local.open(local.cwd) })
    items.push({ label: '刷新', onClick: () => void loadLocal(local.cwd) })
    return items
  }

  const onDrop = (to: Side) => (from: Side | 'finder', paths: string[], targetDir?: string) => {
    if (to === 'remote' && from !== 'remote') void upload(paths, targetDir)
    else if (to === 'local' && from === 'remote') void download(paths, targetDir)
  }

  return (
    <div className="files-view">
      <div className="panes">
        <FilePane
          side="local"
          title="本地"
          cwd={local.cwd}
          entries={local.entries}
          loading={local.loading}
          error={local.error}
          showHidden={showHidden}
          onToggleHidden={() => setShowHidden(!showHidden)}
          onNavigate={(p) => void loadLocal(p.replace(/^~(?=$|\/)/, localHome))}
          onUp={() => void loadLocal(posixParent(local.cwd))}
          onHome={() => void loadLocal(localHome)}
          onRefresh={() => void loadLocal(local.cwd)}
          onOpen={(f) => (f.isDir ? void loadLocal(f.path) : void upload([f.path]))}
          onDropFiles={onDrop('local')}
          buildMenu={localMenu}
          onSelectionChange={setLocalSel}
          onDeleteKey={(l) => void localTrash(l)}
        />
        <div className="pane-actions">
          <button title="上传选中项到远程" disabled={!localSel.length} onClick={() => void upload(localSel.map((f) => f.path))}>
            →
          </button>
          <button title="下载选中项到本地" disabled={!remoteSel.length} onClick={() => void download(remoteSel.map((f) => f.path))}>
            ←
          </button>
        </div>
        <FilePane
          side="remote"
          title="远程"
          cwd={remote.cwd}
          entries={remote.entries}
          loading={remote.loading}
          error={remote.error}
          showHidden={showHidden}
          onToggleHidden={() => setShowHidden(!showHidden)}
          onNavigate={(p) => void loadRemote(p.replace(/^~(?=$|\/)/, props.homeDir))}
          onUp={() => void loadRemote(posixParent(remote.cwd))}
          onHome={() => void loadRemote(props.homeDir)}
          onRefresh={() => void loadRemote(remote.cwd)}
          onOpen={(f) => (f.isDir ? void loadRemote(f.path) : void download([f.path]))}
          onDropFiles={onDrop('remote')}
          buildMenu={remoteMenu}
          onSelectionChange={setRemoteSel}
          onDeleteKey={(l) => void remoteDelete(l)}
        />
      </div>
      <TransferList
        items={transfers}
        onCancel={(id) => void window.api.transfer.cancel(id)}
        onClear={() => setTransfers((l) => l.filter((t) => t.status === 'queued' || t.status === 'running'))}
      />
      {prompt && (
        <PromptDialog
          opts={prompt.opts}
          onDone={(v) => {
            prompt.resolve(v && v.trim() ? v.trim() : null)
            setPrompt(null)
          }}
        />
      )}
      {editing && (
        <TextEditor
          path={editing.path}
          initial={editing.content}
          onSave={async (content) => {
            await window.api.sftp.writeText(connId, editing.path, content)
            notify('已保存 ' + editing.path)
            void loadRemote(remote.cwd)
          }}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}
