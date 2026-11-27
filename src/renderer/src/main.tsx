import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import App from './App'
import QuickApp from './QuickApp'
import { startSettings } from './settings'
import { startKeybindings } from './keybindings'

// 先读取设置再渲染，避免终端先用默认字体创建再闪一下
void startSettings()
  .catch(() => undefined)
  .then(() => {
    // 同一套页面：#quick 是 Quick Terminal 窗口
    startKeybindings()
    const isQuick = location.hash === '#quick'
    document.documentElement.dataset.window = isQuick ? 'quick' : 'main'
    createRoot(document.getElementById('root')!).render(isQuick ? <QuickApp /> : <App />)
  })
