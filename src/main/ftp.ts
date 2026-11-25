import type { WebContents } from 'electron'
import type { ConnectRequest, ConnectResult, FtpOptions } from '../shared/types'
import { register } from './connections'
import { FtpFs, type FtpConfig } from './ftpfs'
import { sessionStore } from './store'

const DEFAULT_FTP: FtpOptions = { security: 'none', ignoreCert: false, anonymous: false }

async function buildConfig(req: ConnectRequest): Promise<{ cfg: FtpConfig; title: string }> {
  if (req.sessionId) {
    const s = await sessionStore.getSecret(req.sessionId)
    if (!s) throw new Error('会话不存在')
    if (s.protocol !== 'ftp') throw new Error('这不是 FTP 会话')
    const o = { ...DEFAULT_FTP, ...s.ftp }
    sessionStore.touch(s.id)
    return {
      title: s.name,
      cfg: {
        host: s.host,
        port: s.port || (o.security === 'implicit' ? 990 : 21),
        user: o.anonymous ? 'anonymous' : s.username,
        password: o.anonymous ? 'anonymous@' : (req.password ?? s.plainPassword ?? ''),
        security: o.security,
        ignoreCert: o.ignoreCert,
        encoding: s.encoding ?? 'utf8'
      }
    }
  }
  if (req.quick) {
    const q = req.quick
    const o = { ...DEFAULT_FTP, ...q.ftp }
    const anonymous = o.anonymous || (!q.password && (q.username === 'anonymous' || q.username === 'ftp'))
    return {
      title: `${q.username}@${q.host}`,
      cfg: {
        host: q.host,
        port: q.port || (o.security === 'implicit' ? 990 : 21),
        user: anonymous ? 'anonymous' : q.username,
        password: anonymous ? 'anonymous@' : (q.password ?? ''),
        security: o.security,
        ignoreCert: o.ignoreCert,
        encoding: q.encoding ?? 'utf8'
      }
    }
  }
  throw new Error('缺少连接参数')
}

export async function connect(req: ConnectRequest, owner: WebContents): Promise<ConnectResult> {
  const { cfg, title } = await buildConfig(req)
  const browse = new FtpFs(cfg)
  // 先登录一次，尽早暴露地址 / 认证 / 证书错误
  await browse.open()
  const homeDir = await browse.realpath('.').catch(() => '/')
  const conn = register({
    protocol: 'ftp',
    title,
    homeDir,
    fs: browse,
    encoding: cfg.encoding,
    owner,
    xfer: new FtpFs(cfg),
    end: () => browse.close()
  })
  return { connId: conn.id, protocol: 'ftp', encoding: cfg.encoding, title, homeDir }
}
