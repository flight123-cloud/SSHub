# SSHub

**English** | [简体中文](README.zh-CN.md)

SSHub is an SSH terminal and SFTP / FTP file transfer client for **macOS and Windows** — manage all your servers, terminals and remote files in one app.

**Website: https://flight123-cloud.github.io/SSHub/**

<p align="center"><img src="build/icon.png" width="128" alt="SSHub icon"></p>

> The app's interface is currently in Simplified Chinese. This README describes every feature in English.

## Features

- **Session manager (sidebar)**: save servers (protocol, name, group, host, port, user, password); connect later by **double-clicking**, clicking "Connect" or pressing **Enter**; search, collapsible groups, duplicate, edit, delete
- **Two protocols**
  - **SSH / SFTP**: terminal + file transfer; password, private key (including passphrase-protected keys), SSH agent / default keys
  - **FTP / FTPS**: file transfer; plain FTP, explicit FTPS (FTP over TLS), implicit FTPS, anonymous login, optional skipping of self-signed certificate checks
- **Quick connect**: type an address in the sidebar and press Enter; tick "save to session list" to keep it
  - `root@1.2.3.4`, `user@host:2222`: SSH
  - `ftp://user@host`, `ftp://host` (anonymous): FTP
  - `ftps://user@host`: explicit FTPS; `ftps-implicit://user@host`: implicit FTPS
- **Tabbed terminal** built on xterm.js: 256 colors, CJK text, find (⌘F), clear (⌘L), font zoom (⌘+ / ⌘-), clickable links
  - **GPU-accelerated rendering** (WebGL) for smooth heavy output (`tail -f`, `top`); falls back automatically when unavailable
  - **Paste protection**: confirm before pasting multi-line text, with an option to strip the trailing newline; stays quiet when the remote program uses bracketed paste (modern bash, vim)
  - **Copy from the server to your Mac's clipboard** (OSC 52) from vim / tmux; the server can never read your clipboard
  - **Copy on select** and right-click to paste (optional, PuTTY-style)
  - Shows "columns × rows" in the middle of the terminal while resizing
  - **Minimum contrast** brightens hard-to-read text colors
  - **Option as Alt** for Alt shortcuts in bash / emacs
  - **Save terminal output to a file** (⌘⇧S)
- **Terminal splits**: split a tab left/right (⌘D) or top/bottom (⌘⇧D); every pane is its own SSH connection
  - Drag dividers to resize, ⌘⌥ + arrow keys to move between panes, ⌘⇧Enter to zoom / restore a pane, ⌘W to close the focused pane
  - Unfocused panes are dimmed so you always know where you are typing
- **Themes**: dark / light / follow system; 14 built-in terminal color schemes (One Dark, Dracula, Solarized, Gruvbox, Nord, Tokyo Night, Monokai, Catppuccin…), chosen separately for dark and light mode
- **Quick Terminal**: press a global hotkey in any app (enable and customize it in Settings, default ⌃\`) and a terminal slides down from the top of the screen, connected to the server you picked; press again to hide — the connection stays open
- **Translucent / blurred background**: adjustable terminal background opacity (30%–100%) and native macOS vibrancy
- **Inline images** via the Sixel and iTerm2 image protocols (`img2sixel`, `imgcat`…)
- **Font ligatures**: `=>`, `!=`, `->` render as ligatures with fonts like Fira Code or JetBrains Mono (enable in Settings)
- **Undo close tab**: reopen a closed tab within 10 seconds with ⌘Z or ⌘⇧T (or the "Undo" button) — the connection is kept alive
- **Notifications**
  - **Long-running command finished**: when a command that ran longer than the threshold (default 10 s) ends while the window or tab is in the background, you get a macOS notification and a Dock bounce; clicking it jumps to the tab
  - Detects command completion from the shell prompt; with shell integration (OSC 133) it also reports the exit code
  - Server-side scripts can notify you with `printf '\e]9;message\a'` (OSC 9) or OSC 777 — e.g. at the end of a build script
  - Background tabs show a marker on bell or notification
- **Command palette**: ⌘P to search sessions / tabs and connect or switch; ⌘⇧P to search and run any action (fuzzy matching — `pdb` finds `prod-db`)
- **Settings** (⌘,): font, size, line height, cursor style, scrollback, GPU rendering, paste protection, clipboard, right-click behavior, double-click behavior for files and more — changes apply instantly
- **Dual-pane file manager (SFTP / FTP)**: local on the left, remote on the right
  - Double-click a file or use the → / ← buttons to transfer, drag between panes, or drop files from Finder onto the remote pane
  - Upload and download whole folders with progress and speed; transfers can be cancelled
  - Remote: new file / folder, rename, delete, duplicate, move to another folder (or drag onto a folder), change permissions (chmod)
  - FTP connections reconnect automatically after an idle disconnect
  - Some FTP servers don't support changing permissions (SITE CHMOD); you'll see an error in that case
- **Edit server files in place**
  - **Double-click a text file** (configs, scripts, code, logs…) to open it in the built-in editor, ⌘S saves it back to the server
  - Syntax highlighting for 100+ languages and config formats, line numbers, find & replace (⌘F, regex), go to line (⌘G), word wrap, bracket matching, code folding
  - Detects the file encoding (UTF-8 / GBK / Big5) and keeps the original encoding, line endings (LF / CRLF) and BOM when saving; switch manually in the status bar
  - Right-click any file → "**Open with local app**" to edit it in VS Code, Word, Preview…; **saving uploads it back automatically**
- **Encoding per session**: UTF-8 / GBK / Big5
  - Terminal: output and input are converted correctly on GBK servers
  - FTP: GBK file names on Windows or older FTP servers display, upload, download and rename correctly
  - SFTP file names are always treated as UTF-8 (a limitation of the underlying library)
- **Terminal + files view**: terminal and file manager stacked in one tab (⌘3)
- **Security**
  - Passwords and passphrases are encrypted with the macOS Keychain / Windows DPAPI and stored only on your computer
  - Host key fingerprints are confirmed on first connect, with a clear warning if they change (man-in-the-middle protection)
- **Reconnect**: after a disconnect, press Enter in the terminal to reconnect

## Finding your way around

- **What's New tour**: shown automatically after an update; reopen it from the ✦ button in the top-right corner or Help → What's New. Every feature has a "try it" button
- **Top-right corner**: "search or run a command" (command palette), ✦ What's New, ? keyboard shortcuts, ⚙ Settings
- **Terminal toolbar**: split right, split down, zoom pane, find, and a "more" menu (clear, save output, equalize panes…)
- **Welcome page**: shortcuts to common actions when no connection is open
- **Keyboard shortcuts**: ⌘/

## Download & install

### macOS

1. Download the installer from the [Releases](../../releases) page (or the artifacts of the latest successful build under [Actions](../../actions)):
   - **Apple silicon (M1 / M2 / M3 / M4…)**: `SSHub-x.y.z-mac-arm64.dmg`
   - **Intel**: `SSHub-x.y.z-mac-x64.dmg`

   Not sure which one? Click  → About This Mac and check "Chip" or "Processor".
2. Open the dmg and drag SSHub into the Applications folder.
3. **First launch**: the app is not notarized by Apple yet, so macOS says it can't verify that "SSHub" is free of malware. Either:
   - Click "Done", open **System Settings → Privacy & Security**, scroll down and click **"Open Anyway"** next to the SSHub message, then confirm;
   - On macOS 14 and earlier you can also **right-click SSHub in Applications → Open → Open**;
   - If macOS says the app "is damaged and can't be opened", run this in Terminal and open it again:

     ```bash
     xattr -cr /Applications/SSHub.app
     ```

### Windows (10 / 11)

1. Download from the [Releases](../../releases) page:
   - **Installer (recommended)**: `SSHub-x.y.z-win-x64-setup.exe` — or `-arm64-setup.exe` for ARM devices such as Surface Pro X / Copilot+ PCs
   - **Portable**: `SSHub-x.y.z-win-x64.zip` — unzip anywhere and run `SSHub.exe`
2. Run the installer and follow the steps (you can choose the install folder; shortcuts are added to the desktop and Start menu).
3. **First launch**: the app is not code-signed yet, so Windows SmartScreen may say "Windows protected your PC". Click **More info → Run anyway**. You only need to do this once.

On Windows the app's own shortcuts use **Ctrl+Shift** (like Windows Terminal) so that Ctrl+C, Ctrl+D, Ctrl+W, Ctrl+Z… keep working in the terminal. Ctrl+C copies when text is selected, and Ctrl+V pastes. The app menu is behind the SSHub icon in the top-left corner.

## Keyboard shortcuts

| Action | macOS | Windows |
|---|---|---|
| New session | ⌘N | Ctrl+Shift+N |
| Search sessions / tabs | ⌘P | Ctrl+Shift+O |
| Command palette | ⌘⇧P | Ctrl+Shift+P |
| Settings | ⌘, | Ctrl+, |
| Quick connect | ⌘K | Ctrl+Shift+K |
| Close the focused pane (closes the tab when only one pane is left) | ⌘W | Ctrl+Shift+W |
| Previous / next tab | ⌘⇧[ / ⌘⇧] | Ctrl+Shift+Tab / Ctrl+Tab |
| Terminal / files / terminal + files | ⌘1 / ⌘2 / ⌘3 | Ctrl+1 / Ctrl+2 / Ctrl+3 |
| Show / hide the session list | ⌘B | Ctrl+Shift+B |
| Find in terminal | ⌘F | Ctrl+Shift+F |
| Clear screen | ⌘L | Ctrl+Shift+L |
| Copy / paste in the terminal | ⌘C / ⌘V | Ctrl+Shift+C / Ctrl+Shift+V (Ctrl+C with a selection, Ctrl+V) |
| Split right / down | ⌘D / ⌘⇧D | Alt+Shift++ / Alt+Shift+- |
| Move between panes | ⌘⌥←→↑↓ | Ctrl+Alt+←→↑↓ |
| Zoom / restore the focused pane | ⌘⇧Enter | Ctrl+Shift+Enter |
| Undo close tab | ⌘Z / ⌘⇧T | Ctrl+Shift+T |
| Save terminal output to a file | ⌘⇧S | Ctrl+Shift+S |
| Bigger / smaller / reset font | ⌘+ / ⌘- / ⌘0 | Ctrl+= / Ctrl+- / Ctrl+0 |
| Keyboard shortcuts | ⌘/ | F1 |
| Save the file in the editor | ⌘S | Ctrl+S |
| Find & replace / go to line in the editor | ⌘F / ⌘G | Ctrl+F / Ctrl+G |

## Where your data lives

The data folder is `~/Library/Application Support/SSHub/` on macOS and `%APPDATA%\SSHub\` on Windows:

- `sessions.json`: sessions (passwords are encrypted with the macOS Keychain / Windows DPAPI)
- `known_hosts.json`: trusted SSH host keys
- `settings.json`: settings

## Development

Stack: Electron + React + TypeScript; [ssh2](https://github.com/mscdex/ssh2) for SSH/SFTP, [basic-ftp](https://github.com/patrickjuchli/basic-ftp) for FTP/FTPS, [xterm.js](https://xtermjs.org/) for the terminal, electron-builder for packaging.

```bash
npm install
npm run dev        # run in development mode
npm run typecheck  # type check
npm run dist:mac   # build the macOS dmg (run on a Mac)
npm run dist:win   # build the Windows installer and zip (run on Windows)
```

GitHub Actions builds the macOS dmg and the Windows installers for every push. Publishing a release with a `v*` tag (e.g. `v0.7.0`) uploads the installers to that release automatically.

```
site/         website (GitHub Pages, deployed on pushes to main)
  index.html    English (default)
  zh/           Simplified Chinese
src/
  main/       main process
    ssh.ts          SSH connection and terminal
    ftp.ts          FTP / FTPS connection
    sftpfs.ts       SFTP file operations
    ftpfs.ts        FTP file operations
    connections.ts  connection registry and transfer queue (shared by both protocols)
    store.ts        session storage (encrypted passwords)
  shared/keymap.ts  keyboard shortcuts for macOS and Windows (one table for menus and UI)
  preload/    secure bridge (contextBridge)
  renderer/   UI (React)
  shared/     shared types
```

## License

[Apache-2.0](LICENSE)
