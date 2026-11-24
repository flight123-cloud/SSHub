import { useState } from 'react'
import type { AuthType, SessionInfo, SessionInput } from '../../../shared/types'
import { Modal } from './Modal'
import { errMsg } from '../util'

export function SessionDialog(props: {
  session?: SessionInfo
  groups: string[]
  onClose: () => void
  onSaved: (s: SessionInfo, connect: boolean) => void
}) {
  const s = props.session
  const [name, setName] = useState(s?.name ?? '')
  const [group, setGroup] = useState(s?.group ?? '')
  const [host, setHost] = useState(s?.host ?? '')
  const [port, setPort] = useState(String(s?.port ?? 22))
  const [username, setUsername] = useState(s?.username ?? 'root')
  const [authType, setAuthType] = useState<AuthType>(s?.authType ?? 'password')
  const [password, setPassword] = useState('')
  const [keyPath, setKeyPath] = useState(s?.privateKeyPath ?? '~/.ssh/id_ed25519')
  const [passphrase, setPassphrase] = useState('')
  const [clearPassword, setClearPassword] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async (connect: boolean): Promise<void> => {
    if (!host.trim()) return setError('请填写主机地址')
    if (!username.trim()) return setError('请填写用户名')
    const p = Number(port)
    if (!Number.isInteger(p) || p < 1 || p > 65535) return setError('端口应为 1-65535')
    const input: SessionInput = {
      id: s?.id,
      name,
      group,
      host,
      port: p,
      username,
      authType,
      privateKeyPath: authType === 'key' ? keyPath : undefined
    }
    if (password) input.password = password
    else if (clearPassword) input.password = ''
    if (passphrase) input.passphrase = passphrase
    setSaving(true)
    try {
      const saved = await window.api.sessions.save(input)
      props.onSaved(saved, connect)
    } catch (e) {
      setError(errMsg(e))
      setSaving(false)
    }
  }

  const pickKey = async (): Promise<void> => {
    const f = await window.api.ui.pickFile('选择私钥文件')
    if (f) setKeyPath(f)
  }

  return (
    <Modal
      title={s ? '编辑会话' : '新建会话'}
      width={520}
      onClose={props.onClose}
      footer={
        <>
          {error && <span className="form-error">{error}</span>}
          <button onClick={props.onClose}>取消</button>
          <button disabled={saving} onClick={() => save(false)}>
            保存
          </button>
          <button className="primary" disabled={saving} onClick={() => save(true)}>
            保存并连接
          </button>
        </>
      }
    >
      <div className="form-grid">
        <label>名称</label>
        <input className="input" value={name} placeholder="可选，例如：生产服务器" onChange={(e) => setName(e.target.value)} />

        <label>分组</label>
        <input
          className="input"
          value={group}
          list="session-groups"
          placeholder="可选，例如：公司"
          onChange={(e) => setGroup(e.target.value)}
        />
        <datalist id="session-groups">
          {props.groups.map((g) => (
            <option key={g} value={g} />
          ))}
        </datalist>

        <label>主机</label>
        <div className="row">
          <input
            className="input grow"
            value={host}
            autoFocus
            placeholder="IP 或域名"
            onChange={(e) => setHost(e.target.value)}
          />
          <span className="muted">端口</span>
          <input className="input port" value={port} onChange={(e) => setPort(e.target.value)} />
        </div>

        <label>用户名</label>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />

        <label>认证方式</label>
        <div className="segmented">
          {(
            [
              ['password', '密码'],
              ['key', '私钥'],
              ['agent', 'SSH Agent']
            ] as [AuthType, string][]
          ).map(([v, l]) => (
            <button key={v} className={authType === v ? 'active' : ''} onClick={() => setAuthType(v)}>
              {l}
            </button>
          ))}
        </div>

        {authType === 'password' && (
          <>
            <label>密码</label>
            <div>
              <input
                className="input full"
                type="password"
                value={password}
                placeholder={s?.hasPassword ? '已保存（留空则不修改）' : '留空则每次连接时询问'}
                onChange={(e) => setPassword(e.target.value)}
              />
              {s?.hasPassword && (
                <label className="checkbox">
                  <input type="checkbox" checked={clearPassword} onChange={(e) => setClearPassword(e.target.checked)} />
                  清除已保存的密码
                </label>
              )}
            </div>
          </>
        )}

        {authType === 'key' && (
          <>
            <label>私钥文件</label>
            <div className="row">
              <input className="input grow" value={keyPath} onChange={(e) => setKeyPath(e.target.value)} />
              <button onClick={pickKey}>浏览…</button>
            </div>
            <label>私钥口令</label>
            <input
              className="input"
              type="password"
              value={passphrase}
              placeholder={s?.hasPassphrase ? '已保存（留空则不修改）' : '没有口令可留空'}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          </>
        )}

        {authType === 'agent' && (
          <>
            <label />
            <div className="muted small">使用系统 SSH Agent 中已加载的密钥（ssh-add）。</div>
          </>
        )}
      </div>
      <div className="muted small" style={{ marginTop: 12 }}>
        密码和口令使用 macOS 钥匙串加密后保存在本机。
      </div>
    </Modal>
  )
}
