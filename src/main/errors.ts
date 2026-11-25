/** 把底层错误转换成中文提示 */
export function friendlyError(err: unknown): string {
  const e = err as NodeJS.ErrnoException & { level?: string; code?: unknown }
  const msg = e?.message || String(err)
  const code: unknown = (err as { code?: unknown })?.code
  if (code === 'ECONNREFUSED') return '连接被拒绝：请检查主机地址和端口，以及服务器上的服务是否运行'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return '无法解析主机名：请检查主机地址'
  if (code === 'ETIMEDOUT' || /Timed out|Timeout \(/i.test(msg)) return '连接超时：请检查网络、端口或防火墙设置'
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return '主机不可达：请检查网络'
  if (code === 'ECONNRESET') return '连接被服务器重置'
  if (code === 'EPIPE') return '连接已断开'
  // SSH
  if (/All configured authentication methods failed/i.test(msg)) return '认证失败：用户名、密码或密钥不正确'
  if (/Cannot parse privateKey|Encrypted private (OpenSSH )?key detected/i.test(msg))
    return '私钥无法解析：如果私钥有口令，请在会话设置中填写口令'
  if (/Host key verification/i.test(msg) || /host.*denied/i.test(msg)) return '已取消：主机密钥未被信任'
  // TLS（FTPS）
  if (
    typeof code === 'string' &&
    /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ERR_TLS_CERT_ALTNAME_INVALID/.test(code)
  )
    return `服务器证书校验失败（${code}）：如果服务器使用自签名证书，可在会话设置中勾选「跳过证书校验」`
  if (/wrong version number|EPROTO|packet length too long/i.test(msg))
    return 'TLS 握手失败：请检查加密方式（显式 / 隐式 FTPS）和端口是否匹配'
  // FTP 响应码
  if (code === 530 || /^530/.test(msg)) return '认证失败：用户名或密码不正确'
  if (code === 550 || /^550/.test(msg)) return '操作失败（550）：文件不存在或没有权限 — ' + msg.replace(/^550\s*/, '')
  if (code === 553 || /^553/.test(msg)) return '文件名不被允许（553）：' + msg
  if (code === 552 || /^552/.test(msg)) return '超出存储空间配额（552）'
  if (code === 421 || /^421/.test(msg)) return '服务器关闭了连接（421）：' + msg
  if (code === 534 || /^534/.test(msg)) return '服务器不支持 FTPS（534）：请把加密方式改为「无（明文 FTP）」'
  if (/User closed client|Client is closed/i.test(msg)) return '已取消'
  // 文件系统
  if (code === 'ENOENT') return '文件不存在：' + (e?.path || msg)
  if (code === 'EACCES' || code === 'EPERM' || code === 3) return '权限不足：' + msg
  if (code === 'ENOSPC') return '本地磁盘空间不足'
  return msg
}
