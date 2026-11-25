import { useState, type ReactNode } from 'react'
import type { AppSettings } from '../../../shared/types'
import { Modal } from './Modal'

type Tab = 'terminal' | 'behavior' | 'files'

const FONT_PRESETS: [string, string][] = [
  ['SF Mono（系统默认）', '"SF Mono", Menlo, Monaco, "PingFang SC", "Courier New", monospace'],
  ['Menlo', 'Menlo, "PingFang SC", monospace'],
  ['Monaco', 'Monaco, "PingFang SC", monospace'],
  ['JetBrains Mono', '"JetBrains Mono", "SF Mono", Menlo, "PingFang SC", monospace'],
  ['Fira Code', '"Fira Code", "SF Mono", Menlo, "PingFang SC", monospace'],
  ['Source Code Pro', '"Source Code Pro", "SF Mono", Menlo, "PingFang SC", monospace'],
  ['Courier New', '"Courier New", "PingFang SC", monospace']
]

function Row(props: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-label">
        {props.label}
        {props.hint && <div className="set-hint">{props.hint}</div>}
      </div>
      <div className="set-control">{props.children}</div>
    </div>
  )
}

function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} aria-label={props.label} />
      <span className="slider" />
    </label>
  )
}

export function SettingsDialog(props: {
  settings: AppSettings
  onChange: (patch: Partial<AppSettings>) => void
  onReset: () => void
  onClose: () => void
}) {
  const s = props.settings
  const set = props.onChange
  const [tab, setTab] = useState<Tab>('terminal')
  const presetValue = FONT_PRESETS.find(([, v]) => v === s.fontFamily)?.[1] ?? 'custom'
  const [customMode, setCustomMode] = useState(presetValue === 'custom')
  const [customFont, setCustomFont] = useState(s.fontFamily)

  return (
    <Modal
      title="设置"
      width={640}
      onClose={props.onClose}
      footer={
        <>
          <button className="link danger-link" onClick={props.onReset}>
            恢复默认设置
          </button>
          <span className="grow" />
          <span className="muted small">修改会立即生效并自动保存</span>
          <button className="primary" onClick={props.onClose}>
            完成
          </button>
        </>
      }
    >
      <div className="segmented settings-tabs">
        <button className={tab === 'terminal' ? 'active' : ''} onClick={() => setTab('terminal')}>
          终端外观
        </button>
        <button className={tab === 'behavior' ? 'active' : ''} onClick={() => setTab('behavior')}>
          终端行为
        </button>
        <button className={tab === 'files' ? 'active' : ''} onClick={() => setTab('files')}>
          连接与文件
        </button>
      </div>

      {tab === 'terminal' && (
        <div className="set-list">
          <Row label="字体">
            <select
              className="input"
              value={customMode ? 'custom' : presetValue}
              onChange={(e) => {
                if (e.target.value === 'custom') {
                  setCustomMode(true)
                  setCustomFont(s.fontFamily)
                } else {
                  setCustomMode(false)
                  set({ fontFamily: e.target.value })
                }
              }}
            >
              {FONT_PRESETS.map(([l, v]) => (
                <option key={l} value={v}>
                  {l}
                </option>
              ))}
              <option value="custom">自定义…</option>
            </select>
          </Row>
          {customMode ? (
            <Row label="自定义字体" hint="CSS 字体列表，例如 &quot;Hack Nerd Font&quot;, Menlo">
              <input
                className="input full"
                value={customFont}
                onChange={(e) => setCustomFont(e.target.value)}
                onBlur={() => customFont.trim() && set({ fontFamily: customFont.trim() })}
                onKeyDown={(e) => e.key === 'Enter' && customFont.trim() && set({ fontFamily: customFont.trim() })}
              />
            </Row>
          ) : null}
          <Row label="字号" hint="也可以用 ⌘+ / ⌘- 调整">
            <div className="row">
              <input
                type="range"
                min={9}
                max={32}
                value={s.fontSize}
                onChange={(e) => set({ fontSize: Number(e.target.value) })}
              />
              <span className="set-value">{s.fontSize}</span>
            </div>
          </Row>
          <Row label="行高">
            <div className="row">
              <input
                type="range"
                min={1}
                max={1.6}
                step={0.05}
                value={s.lineHeight}
                onChange={(e) => set({ lineHeight: Number(e.target.value) })}
              />
              <span className="set-value">{s.lineHeight.toFixed(2)}</span>
            </div>
          </Row>
          <Row label="光标样式">
            <div className="segmented">
              {(
                [
                  ['block', '方块 █'],
                  ['bar', '竖线 ▏'],
                  ['underline', '下划线 _']
                ] as [AppSettings['cursorStyle'], string][]
              ).map(([v, l]) => (
                <button key={v} className={s.cursorStyle === v ? 'active' : ''} onClick={() => set({ cursorStyle: v })}>
                  {l}
                </button>
              ))}
            </div>
          </Row>
          <Row label="光标闪烁">
            <Toggle checked={s.cursorBlink} onChange={(v) => set({ cursorBlink: v })} />
          </Row>
          <Row label="最低对比度" hint="自动调亮看不清的文字颜色（例如深蓝色文字在黑色背景上）">
            <select className="input" value={String(s.minimumContrast)} onChange={(e) => set({ minimumContrast: Number(e.target.value) })}>
              <option value="1">关闭</option>
              <option value="1.5">轻微（防止文字完全看不见）</option>
              <option value="3">适中</option>
              <option value="4.5">高（WCAG AA 标准）</option>
              <option value="7">很高（WCAG AAA 标准）</option>
            </select>
          </Row>
          <Row label="回滚行数" hint="终端可以向上翻看的历史行数">
            <select className="input" value={String(s.scrollback)} onChange={(e) => set({ scrollback: Number(e.target.value) })}>
              {[1000, 5000, 10000, 50000, 100000].map((n) => (
                <option key={n} value={n}>
                  {n.toLocaleString()} 行
                </option>
              ))}
            </select>
          </Row>
          <Row label="GPU 加速渲染" hint="使用 WebGL 渲染终端，大量输出时更流畅。显示异常时可以关闭">
            <Toggle checked={s.gpuRendering} onChange={(v) => set({ gpuRendering: v })} />
          </Row>
        </div>
      )}

      {tab === 'behavior' && (
        <div className="set-list">
          <Row label="粘贴保护" hint="粘贴包含换行的内容时先确认，防止误执行多行命令。远程程序开启括号粘贴模式（如 vim、新版 bash）时不提示">
            <Toggle checked={s.pasteProtection} onChange={(v) => set({ pasteProtection: v })} />
          </Row>
          <Row label="选中即复制" hint="在终端里选中文字后自动复制到剪贴板（类似 PuTTY / Xshell）">
            <Toggle checked={s.copyOnSelect} onChange={(v) => set({ copyOnSelect: v })} />
          </Row>
          <Row label="允许服务器写入剪贴板" hint="服务器上的 vim、tmux 等程序复制的内容会同步到 Mac 剪贴板（OSC 52）。服务器读取剪贴板始终被禁止">
            <Toggle checked={s.osc52Write} onChange={(v) => set({ osc52Write: v })} />
          </Row>
          <Row label="Option 键作为 Alt" hint="开启后 Option+B / Option+F 等可以在 bash、emacs 中按词移动，但无法再用 Option 输入特殊符号">
            <Toggle checked={s.optionAsAlt} onChange={(v) => set({ optionAsAlt: v })} />
          </Row>
          <Row label="终端中右键">
            <div className="segmented">
              <button className={s.rightClick === 'menu' ? 'active' : ''} onClick={() => set({ rightClick: 'menu' })}>
                弹出菜单
              </button>
              <button className={s.rightClick === 'paste' ? 'active' : ''} onClick={() => set({ rightClick: 'paste' })}>
                直接粘贴
              </button>
            </div>
          </Row>
          <Row label="调整大小时显示行列数" hint="拖动窗口或分隔条时，在终端中央短暂显示「列 × 行」">
            <Toggle checked={s.resizeOverlay} onChange={(v) => set({ resizeOverlay: v })} />
          </Row>
        </div>
      )}

      {tab === 'files' && (
        <div className="set-list">
          <Row label="关闭已连接的标签页前确认">
            <Toggle checked={s.confirmCloseConnected} onChange={(v) => set({ confirmCloseConnected: v })} />
          </Row>
          <Row label="双击远程文本文件">
            <div className="segmented">
              <button className={s.doubleClickText === 'edit' ? 'active' : ''} onClick={() => set({ doubleClickText: 'edit' })}>
                在线编辑
              </button>
              <button className={s.doubleClickText === 'download' ? 'active' : ''} onClick={() => set({ doubleClickText: 'download' })}>
                下载到本地
              </button>
            </div>
          </Row>
          <Row label="默认显示隐藏文件" hint="以 . 开头的文件，例如 .bashrc">
            <Toggle checked={s.showHiddenFiles} onChange={(v) => set({ showHiddenFiles: v })} />
          </Row>
        </div>
      )}
    </Modal>
  )
}
