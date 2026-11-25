import type { ReactNode } from 'react'
import { Modal } from './Modal'
import type { SettingsTab } from './SettingsDialog'
import { IconBolt, IconCommand, IconHelp, IconSparkle, IconSplitRight } from './Icons'

export interface TourActions {
  openPalette: () => void
  openSettings: (tab: SettingsTab) => void
  splitRight: () => void
  openShortcuts: () => void
  /** 当前是否有已连接的 SSH 标签页（分屏需要） */
  canSplit: boolean
}

interface Feature {
  title: string
  desc: ReactNode
  keys?: string[]
  icon?: ReactNode
  tag?: string
  action?: { label: string; run: () => void; disabled?: string }
}

function Keys(props: { keys: string[] }) {
  return (
    <span className="tour-keys">
      {props.keys.map((k) => (
        <kbd key={k}>{k}</kbd>
      ))}
    </span>
  )
}

export function WhatsNew(props: { version: string; actions: TourActions; onClose: () => void }) {
  const a = props.actions
  // 点「试一试」时先关闭导览，再执行
  const go = (fn: () => void) => () => {
    props.onClose()
    setTimeout(fn, 50)
  }
  const features: Feature[] = [
    {
      title: '命令面板',
      icon: <IconCommand />,
      tag: '最常用',
      desc: '不用记菜单和快捷键：搜索服务器直接连接，或者搜索任何操作并执行，例如输入「拆分」「主题」「通知」。',
      keys: ['⌘P 搜索服务器', '⌘⇧P 搜索操作'],
      action: { label: '打开命令面板', run: go(a.openPalette) }
    },
    {
      title: '终端分屏',
      icon: <IconSplitRight />,
      desc: '一个标签页里同时开多个终端，比如一边看日志一边操作。终端上方工具栏也有拆分按钮。',
      keys: ['⌘D 向右拆分', '⌘⇧D 向下拆分', '⌘⌥方向键 切换', '⌘⇧↩ 放大', '⌘W 关闭分屏'],
      action: {
        label: '在当前终端向右拆分',
        run: go(a.splitRight),
        disabled: a.canSplit ? undefined : '先连接一台 SSH 服务器后可用'
      }
    },
    {
      title: 'Quick Terminal 下拉终端',
      icon: <IconBolt />,
      desc: '在任何应用里按全局快捷键，终端从屏幕顶部滑出，自动连接常用服务器；再按一次收起。需要先在设置里开启。',
      keys: ['默认 ⌃`（可自定义）'],
      action: { label: '去设置开启', run: go(() => a.openSettings('quick')) }
    },
    {
      title: '外观与主题',
      icon: <IconSparkle />,
      desc: '深色 / 浅色 / 跟随系统，14 套终端配色可预览选择；还可以调终端背景透明度、开启毛玻璃效果。',
      action: { label: '打开外观设置', run: go(() => a.openSettings('appearance')) }
    },
    {
      title: '长命令完成通知',
      desc: '命令运行超过 10 秒，结束时如果你没在看这个窗口或标签页，会弹出系统通知并在标签页上做标记，点通知直接跳回去。',
      action: { label: '通知设置', run: go(() => a.openSettings('behavior')) }
    },
    {
      title: '撤销关闭标签页',
      desc: '误关了标签页？10 秒内恢复，连接不会断开，终端内容也还在。',
      keys: ['⌘Z', '⌘⇧T']
    },
    {
      title: '更安全的粘贴与剪贴板',
      desc: '粘贴多行内容前先确认，防止误执行命令；服务器上 vim / tmux 里复制的内容会同步到 Mac 剪贴板。还可以开启「选中即复制」。',
      action: { label: '终端行为设置', run: go(() => a.openSettings('behavior')) }
    },
    {
      title: '在线编辑服务器文件',
      desc: (
        <>
          在「文件传输」里<b>双击文本文件</b>直接编辑，⌘S 保存回服务器；任意文件可以右键「用本地应用打开」，用 VS Code
          等编辑，保存后自动上传。
        </>
      )
    },
    {
      title: '终端图片与连字',
      desc: '支持 Sixel / iTerm2 图片协议（img2sixel、imgcat）；使用 Fira Code、JetBrains Mono 等字体时可开启连字。',
      action: { label: '终端外观设置', run: go(() => a.openSettings('terminal')) }
    },
    {
      title: '快捷键与帮助',
      icon: <IconHelp />,
      desc: '按 ⌘/ 查看全部快捷键。菜单栏「帮助 → 新功能介绍」可以随时再次打开这个页面。',
      keys: ['⌘/ 快捷键一览', '⌘, 设置'],
      action: { label: '查看快捷键', run: go(a.openShortcuts) }
    }
  ]

  return (
    <Modal
      title={`SSHub ${props.version} 新功能`}
      width={820}
      onClose={props.onClose}
      footer={
        <>
          <span className="muted small grow">以后可以在「帮助 → 新功能介绍」或标题栏右上角的 ✦ 按钮再次查看</span>
          <button className="primary" onClick={props.onClose}>
            开始使用
          </button>
        </>
      }
    >
      <div className="tour-intro">
        这个版本增加了不少功能，大部分都能通过<b>标题栏右上角的按钮</b>、<b>终端上方的工具栏</b>或<b>命令面板</b>找到。下面是一览：
      </div>
      <div className="tour-grid">
        {features.map((f) => (
          <div key={f.title} className="tour-card">
            <div className="tour-title">
              {f.icon && <span className="tour-icon">{f.icon}</span>}
              {f.title}
              {f.tag && <span className="tour-tag">{f.tag}</span>}
            </div>
            <div className="tour-desc">{f.desc}</div>
            {f.keys && <Keys keys={f.keys} />}
            {f.action && (
              <div className="tour-action">
                <button disabled={!!f.action.disabled} onClick={f.action.run} title={f.action.disabled}>
                  {f.action.label}
                </button>
                {f.action.disabled && <span className="muted small">{f.action.disabled}</span>}
              </div>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}

const SHORTCUTS: [string, [string, string][]][] = [
  [
    '连接与标签页',
    [
      ['⌘N', '新建会话'],
      ['⌘K', '快速连接'],
      ['⌘P', '搜索服务器 / 标签页'],
      ['⌘⇧P', '命令面板（搜索任何操作）'],
      ['⌘W', '关闭分屏 / 标签页'],
      ['⌘Z / ⌘⇧T', '撤销关闭标签页'],
      ['⌘⇧[ / ⌘⇧]', '上一个 / 下一个标签页'],
      ['⌘B', '显示 / 隐藏会话列表']
    ]
  ],
  [
    '终端',
    [
      ['⌘1 / ⌘2 / ⌘3', '终端 / 文件传输 / 终端+文件'],
      ['⌘F', '查找'],
      ['⌘L', '清屏'],
      ['⌘⇧S', '将终端输出保存为文件'],
      ['⌘+ / ⌘- / ⌘0', '放大 / 缩小 / 重置字体']
    ]
  ],
  [
    '分屏',
    [
      ['⌘D', '向右拆分'],
      ['⌘⇧D', '向下拆分'],
      ['⌘⌥ 方向键', '切换到相邻分屏'],
      ['⌘[ / ⌘]', '上一个 / 下一个分屏'],
      ['⌘⇧↩', '放大 / 还原当前分屏'],
      ['⌘⌃=', '均分所有分屏']
    ]
  ],
  [
    '文件与编辑器',
    [
      ['双击文本文件', '在线编辑'],
      ['⌘S', '保存到服务器'],
      ['⌘F / ⌘G', '查找替换 / 跳转到行'],
      ['⌘A', '全选文件'],
      ['⌘⌫', '删除选中文件']
    ]
  ],
  [
    '其他',
    [
      ['⌘,', '设置'],
      ['⌘/', '快捷键一览'],
      ['自定义（默认 ⌃`）', 'Quick Terminal（需在设置中开启）']
    ]
  ]
]

export function ShortcutsDialog(props: { onClose: () => void }) {
  return (
    <Modal
      title="快捷键一览"
      width={720}
      onClose={props.onClose}
      footer={
        <button className="primary" onClick={props.onClose}>
          关闭
        </button>
      }
    >
      <div className="shortcut-grid">
        {SHORTCUTS.map(([group, items]) => (
          <div key={group} className="shortcut-group">
            <div className="shortcut-title">{group}</div>
            {items.map(([k, d]) => (
              <div key={k} className="shortcut-row">
                <kbd>{k}</kbd>
                <span>{d}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Modal>
  )
}

