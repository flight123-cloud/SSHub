# SSHub

SSHub 是一款 macOS 上的 SSH 远程连接 + SFTP 文件传输工具，相当于把 Xshell 和 Xftp 合在一个应用里。

<p align="center"><img src="build/icon.png" width="128" alt="SSHub 图标"></p>

## 功能

- **会话管理**：保存服务器（名称、分组、主机、端口、用户名），支持搜索、复制、编辑、删除
- **三种登录方式**：密码、私钥（支持带口令的私钥）、系统 SSH Agent
- **快速连接**：在侧边栏输入 `user@host:port` 回车即可连接
- **多标签终端**：基于 xterm.js，支持 256 色、中文、查找（⌘F）、清屏（⌘L）、字体缩放（⌘+ / ⌘-）、链接点击
- **SFTP 双栏文件管理**：左边本地、右边远程
  - 双击文件或用 → / ← 按钮传输，也可以在两栏之间拖拽，或直接从 Finder 拖文件到远程栏上传
  - 支持整个文件夹上传和下载，显示进度和速度，传输可以取消
  - 远程文件可以新建、重命名、删除、修改权限（chmod），也能直接在线编辑文本文件
- **分屏模式**：终端和文件管理上下同时显示（⌘3）
- **安全**
  - 密码和口令用 macOS 钥匙串加密后保存在本机
  - 首次连接会确认服务器指纹，指纹变化时会发出警告（防止中间人攻击）
- **断线重连**：连接断开后，在终端里按 Enter 就能重新连接

## 下载安装

1. 打开本仓库的 [Releases](../../releases) 页面（或 [Actions](../../actions) 里最新一次成功构建的 Artifacts），下载安装包：
   - **Apple 芯片（M1/M2/M3/M4…）**：`SSHub-x.y.z-mac-arm64.dmg`
   - **Intel 芯片**：`SSHub-x.y.z-mac-x64.dmg`

   不知道是哪种芯片？点屏幕左上角  →「关于本机」，看「芯片」或「处理器」那一项。
2. 双击 dmg，把 SSHub 拖进「应用程序」文件夹。
3. **第一次打开**：这个应用没有经过 Apple 公证，macOS 会提示「无法验证开发者」。可以用下面任一方法解决：
   - 在「应用程序」里**右键点 SSHub →「打开」→ 再点「打开」**；
   - 或者到「系统设置 → 隐私与安全性」，在页面下方点「仍要打开」；
   - 如果提示「已损坏，无法打开」，在「终端」里执行下面这条命令，然后再打开：

     ```bash
     xattr -cr /Applications/SSHub.app
     ```

## 快捷键

| 快捷键 | 功能 |
|---|---|
| ⌘N | 新建会话 |
| ⌘K | 快速连接 |
| ⌘W | 关闭当前标签 |
| ⌘⇧[ / ⌘⇧] | 切换上一个 / 下一个标签 |
| ⌘1 / ⌘2 / ⌘3 | 切换到 终端 / 文件传输 / 分屏 |
| ⌘B | 显示 / 隐藏会话列表 |
| ⌘F | 在终端中查找 |
| ⌘L | 清屏 |
| ⌘+ / ⌘- / ⌘0 | 放大 / 缩小 / 重置字体 |
| ⌘S | 在线编辑文件时保存 |

## 数据存放位置

- 会话：`~/Library/Application Support/SSHub/sessions.json`（密码是加密后保存的）
- 已信任的主机指纹：`~/Library/Application Support/SSHub/known_hosts.json`

## 开发

技术栈：Electron + React + TypeScript；SSH/SFTP 用 [ssh2](https://github.com/mscdex/ssh2)，终端用 [xterm.js](https://xtermjs.org/)，打包用 electron-builder。

```bash
npm install
npm run dev        # 开发模式运行
npm run typecheck  # 类型检查
npm run dist:mac   # 打包 macOS dmg（需要在 Mac 上执行）
```

每次推送代码后，GitHub Actions 会自动在 macOS 上构建 dmg。推送 `v*` 格式的标签（例如 `v0.1.0`）时，还会自动发布 Release。

```
src/
  main/       主进程：SSH 连接、SFTP、传输队列、会话存储
  preload/    安全桥接（contextBridge）
  renderer/   界面（React）
  shared/     共享类型
```

## 许可证

[Apache-2.0](LICENSE)
