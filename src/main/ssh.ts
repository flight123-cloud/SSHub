import { dialog } from 'electron'
import { Client, type ClientChannel, type ConnectConfig } from 'ssh2'
import { createHash } from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { ConnectRequest, ConnectResult } from '../shared/types'
import { knownHosts, sessionStore } from './store'
import { friendlyError } from './errors'
import { SftpFs } from './sftpfs'
import { getMainWindow, markClosed, register, send, get } from './connections'

/** 每个 SSH 连接的交互式 Shell */
const shells = new Map<string, ClientChannel>()

/** ~/.ssh 下第一个可读的默认私钥 */
function defaultPrivateKey(): Buffer | undefined {
  for (const f of ['id_ed25519', 'id_ecdsa', 'id_rsa']) {
    try {
      return fs.readFileSync(path.join(os.homedir(), '.ssh', f))
    } catch {
      /* 不存在或不可读 */
    }
  }
  return undefined
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir()
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2))
  return p
}

/** 主机指纹校验：首次连接询问，变更时警告 */
function makeHostVerifier(hostPort: string) {
  return (key: Buffer, verify: (ok: boolean) => void): void => {
    const fp = 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
    const known = knownHosts.get(hostPort)
    if (known === fp) return verify(true)
    const win = getMainWindow() ?? undefined
    const changed = !!known
    const opts: Electron.MessageBoxOptions = changed
      ? {
          type: 'warning',
          title: '主机密钥已变更',
          message: `警告：${hostPort} 的主机密钥与之前保存的不一致！`,
          detail: `这可能意味着有人在进行中间人攻击，也可能是服务器重装了系统。\n\n旧指纹：${known}\n新指纹：${fp}\n\n确定要信任新的密钥并继续连接吗？`,
          buttons: ['取消', '信任并继续'],
          defaultId: 0,
          cancelId: 0
        }
      : {
          type: 'question',
          title: '未知主机',
          message: `首次连接 ${hostPort}`,
          detail: `服务器主机密钥指纹：\n${fp}\n\n是否信任该主机并继续连接？`,
          buttons: ['取消', '信任并连接'],
          defaultId: 1,
          cancelId: 0
        }
    const p = win ? dialog.showMessageBox(win, opts) : dialog.showMessageBox(opts)
    p.then((r) => {
      if (r.response === 1) {
        knownHosts.set(hostPort, fp)
        verify(true)
      } else verify(false)
    }).catch(() => verify(false))
  }
}

async function buildConfig(req: ConnectRequest): Promise<{ cfg: ConnectConfig; title: string; password?: string }> {
  if (req.sessionId) {
    const s = await sessionStore.getSecret(req.sessionId)
    if (!s) throw new Error('会话不存在')
    if (s.protocol === 'ftp') throw new Error('这是 FTP 会话')
    const password = req.password || s.plainPassword
    const cfg: ConnectConfig = {
      host: s.host,
      port: s.port,
      username: s.username,
      readyTimeout: 20000,
      keepaliveInterval: 30000,
      keepaliveCountMax: 4,
      tryKeyboard: true,
      hostVerifier: makeHostVerifier(`${s.host}:${s.port}`)
    }
    if (s.authType === 'password') {
      cfg.password = password
    } else if (s.authType === 'key') {
      const keyPath = expandHome(s.privateKeyPath || '~/.ssh/id_ed25519')
      try {
        cfg.privateKey = fs.readFileSync(keyPath)
      } catch {
        throw new Error('无法读取私钥文件：' + keyPath)
      }
      if (s.plainPassphrase) cfg.passphrase = s.plainPassphrase
      if (password) cfg.password = password
    } else if (s.authType === 'agent') {
      // SSH Agent + ~/.ssh 下的默认私钥（与终端里直接 ssh 的行为一致）
      if (process.env.SSH_AUTH_SOCK) cfg.agent = process.env.SSH_AUTH_SOCK
      const key = defaultPrivateKey()
      if (key) cfg.privateKey = key
      if (!cfg.agent && !cfg.privateKey)
        throw new Error('未找到可用的密钥：SSH Agent 未运行，~/.ssh 下也没有 id_ed25519 / id_ecdsa / id_rsa')
    }
    sessionStore.touch(s.id)
    return { cfg, title: s.name, password }
  }
  if (req.quick) {
    const q = req.quick
    const cfg: ConnectConfig = {
      host: q.host,
      port: q.port || 22,
      username: q.username,
      password: q.password,
      readyTimeout: 20000,
      keepaliveInterval: 30000,
      keepaliveCountMax: 4,
      tryKeyboard: true,
      hostVerifier: makeHostVerifier(`${q.host}:${q.port || 22}`)
    }
    // 快速连接且未填密码时，尝试系统 SSH Agent 与默认私钥
    if (!q.password) {
      if (process.env.SSH_AUTH_SOCK) cfg.agent = process.env.SSH_AUTH_SOCK
      const key = defaultPrivateKey()
      if (key) cfg.privateKey = key
    }
    return { cfg, title: `${q.username}@${q.host}`, password: q.password }
  }
  throw new Error('缺少连接参数')
}

export async function connect(req: ConnectRequest): Promise<ConnectResult> {
  const { cfg, title, password } = await buildConfig(req)
  const client = new Client()

  client.on('keyboard-interactive', (_name, _instr, _lang, prompts, finish) => {
    // 常见的 keyboard-interactive 只问密码
    finish(prompts.map(() => password ?? ''))
  })

  await new Promise<void>((resolve, reject) => {
    let settled = false
    client.once('ready', () => {
      settled = true
      resolve()
    })
    client.once('error', (err) => {
      if (!settled) {
        settled = true
        reject(new Error(friendlyError(err)))
      }
    })
    client.once('close', () => {
      if (!settled) {
        settled = true
        reject(new Error('连接已关闭'))
      }
    })
    try {
      client.connect(cfg)
    } catch (err) {
      settled = true
      reject(new Error(friendlyError(err)))
    }
  })

  const sftpFs = new SftpFs(client)
  const conn = register({
    protocol: 'ssh',
    title,
    homeDir: '/',
    fs: sftpFs,
    xfer: new SftpFs(client),
    end: () => client.end()
  })
  const id = conn.id

  client.on('error', (err) => send('ssh:error', id, friendlyError(err)))
  client.on('close', () => {
    shells.delete(id)
    const c = get(id)
    if (c) markClosed(c)
    send('ssh:closed', id)
  })

  // 打开交互式 Shell
  const shell = await new Promise<ClientChannel>((resolve, reject) => {
    client.shell(
      { term: 'xterm-256color', cols: req.cols || 80, rows: req.rows || 24 },
      { env: { LANG: process.env.LANG || 'en_US.UTF-8', LC_CTYPE: 'UTF-8' } },
      (err, stream) => (err ? reject(new Error(friendlyError(err))) : resolve(stream))
    )
  })
  shells.set(id, shell)
  shell.on('data', (d: Buffer) => send('ssh:data', id, new Uint8Array(d)))
  shell.stderr.on('data', (d: Buffer) => send('ssh:data', id, new Uint8Array(d)))
  shell.on('close', () => client.end())

  // 预先获取远程 home 目录
  try {
    conn.homeDir = await sftpFs.realpath('.')
  } catch {
    /* 部分服务器不支持 SFTP，忽略 */
  }

  return { connId: id, protocol: 'ssh', title, homeDir: conn.homeDir }
}

export function write(connId: string, data: string): void {
  shells.get(connId)?.write(data)
}

export function resize(connId: string, cols: number, rows: number): void {
  const sh = shells.get(connId)
  if (sh && cols > 0 && rows > 0) sh.setWindow(rows, cols, 0, 0)
}
