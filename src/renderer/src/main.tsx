import { createRoot } from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import './styles.css'
import App from './App'
import { startSettings } from './settings'

// 先读取设置再渲染，避免终端先用默认字体创建再闪一下
void startSettings()
  .catch(() => undefined)
  .then(() => createRoot(document.getElementById('root')!).render(<App />))
