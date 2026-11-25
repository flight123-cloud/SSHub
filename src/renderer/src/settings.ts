import { useSyncExternalStore } from 'react'
import { DEFAULT_SETTINGS, type AppSettings } from '../../shared/types'

/** 界面共享的设置：启动时从主进程读取，之后跟随主进程广播更新 */
let current: AppSettings = { ...DEFAULT_SETTINGS }
const listeners = new Set<() => void>()
let started = false

function emit(): void {
  listeners.forEach((l) => l())
}

export function startSettings(): Promise<void> {
  if (started) return Promise.resolve()
  started = true
  window.api.settings.onChange((s) => {
    current = s
    emit()
  })
  return window.api.settings.get().then((s) => {
    current = s
    emit()
  })
}

export function getSettings(): AppSettings {
  return current
}

export function updateSettings(patch: Partial<AppSettings>): void {
  // 先本地生效，主进程保存后会再广播一次
  current = { ...current, ...patch }
  emit()
  void window.api.settings.set(patch)
}

export function useSettings(): AppSettings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current
  )
}

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')

/** 当前是否为深色外观（跟随系统时随系统切换） */
export function useIsDark(): boolean {
  const s = useSettings()
  const systemDark = useSyncExternalStore(
    (l) => {
      darkQuery.addEventListener('change', l)
      return () => darkQuery.removeEventListener('change', l)
    },
    () => darkQuery.matches
  )
  return s.appearance === 'system' ? systemDark : s.appearance === 'dark'
}
