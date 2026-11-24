import type { TransferItem } from '../../shared/types'

type DataFn = (data: Uint8Array) => void
type VoidFn = () => void
type ErrFn = (msg: string) => void

const dataHandlers = new Map<string, DataFn>()
const closeHandlers = new Map<string, VoidFn>()
const errorHandlers = new Map<string, ErrFn>()
const transferListeners = new Set<(t: TransferItem) => void>()
/** 在终端注册前到达的数据先缓存 */
const pending = new Map<string, Uint8Array[]>()

let started = false
export function startBus(): void {
  if (started) return
  started = true
  window.api.ssh.onData((id, data) => {
    const h = dataHandlers.get(id)
    if (h) h(data)
    else {
      const arr = pending.get(id) ?? []
      arr.push(data)
      pending.set(id, arr)
    }
  })
  window.api.ssh.onClosed((id) => {
    pending.delete(id)
    closeHandlers.get(id)?.()
  })
  window.api.ssh.onError((id, msg) => errorHandlers.get(id)?.(msg))
  window.api.transfer.onUpdate((t) => transferListeners.forEach((l) => l(t)))
}

export function bindConnection(id: string, h: { data: DataFn; close: VoidFn; error: ErrFn }): () => void {
  dataHandlers.set(id, h.data)
  closeHandlers.set(id, h.close)
  errorHandlers.set(id, h.error)
  const buf = pending.get(id)
  if (buf) {
    pending.delete(id)
    buf.forEach(h.data)
  }
  return () => {
    dataHandlers.delete(id)
    closeHandlers.delete(id)
    errorHandlers.delete(id)
  }
}

export function onTransfer(l: (t: TransferItem) => void): () => void {
  transferListeners.add(l)
  return () => transferListeners.delete(l)
}

/** 菜单 / 快捷键命令 */
const cmdListeners = new Set<(cmd: string) => void>()
export function emitCommand(cmd: string): void {
  cmdListeners.forEach((l) => l(cmd))
}
export function onCommand(l: (cmd: string) => void): () => void {
  cmdListeners.add(l)
  return () => cmdListeners.delete(l)
}
