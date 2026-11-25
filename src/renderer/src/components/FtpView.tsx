import { useEffect, useRef, useState } from 'react'
import type { ConnectRequest, ConnectResult } from '../../../shared/types'
import { errMsg } from '../util'
import { FilesView } from './FilesView'
import type { ConnStatus } from './TerminalView'

/** FTP 标签页：没有终端，只有文件管理 */
export function FtpView(props: {
  active: boolean
  prepare: (retryAuth: boolean) => Promise<Omit<ConnectRequest, 'cols' | 'rows'> | null>
  onStatus: (status: ConnStatus, info?: ConnectResult, error?: string) => void
  notify: (msg: string, error?: boolean) => void
}) {
  const [status, setStatus] = useState<ConnStatus>('connecting')
  const [conn, setConn] = useState<ConnectResult | null>(null)
  const [error, setError] = useState('')
  const connIdRef = useRef<string | null>(null)
  const authFailed = useRef(false)
  const propsRef = useRef(props)
  propsRef.current = props

  const update = (s: ConnStatus, info?: ConnectResult, err?: string): void => {
    setStatus(s)
    propsRef.current.onStatus(s, info, err)
  }

  const connect = async (): Promise<void> => {
    update('connecting')
    setError('')
    const req = await propsRef.current.prepare(authFailed.current)
    if (!req) {
      setError('已取消连接')
      update('closed')
      return
    }
    try {
      const res = await window.api.ftp.connect({ ...req, cols: 0, rows: 0 })
      connIdRef.current = res.connId
      authFailed.current = false
      setConn(res)
      update('connected', res)
    } catch (e) {
      const msg = errMsg(e)
      authFailed.current = /认证失败/.test(msg)
      setError(msg)
      update('error', undefined, msg)
    }
  }

  const disconnect = (): void => {
    if (connIdRef.current) void window.api.ftp.disconnect(connIdRef.current)
    connIdRef.current = null
    setConn(null)
    setError('')
    update('closed')
  }

  useEffect(() => {
    void connect()
    return () => {
      if (connIdRef.current) void window.api.ftp.disconnect(connIdRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (status === 'connected' && conn) {
    return (
      <div className="ftp-view">
        <FilesView key={conn.connId} connId={conn.connId} homeDir={conn.homeDir} active={props.active} notify={props.notify} />
        <div className="ftp-foot">
          <button className="link" onClick={disconnect}>
            断开连接
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ftp-status">
      {status === 'connecting' && <div className="muted">正在连接 FTP 服务器…</div>}
      {status !== 'connecting' && (
        <>
          <div className={error && status === 'error' ? 'error-text' : 'muted'}>
            {error ? (status === 'error' ? '连接失败：' + error : error) : '已断开连接'}
          </div>
          <button className="primary" onClick={() => void connect()}>
            {authFailed.current ? '重新输入密码并连接' : '重新连接'}
          </button>
        </>
      )}
    </div>
  )
}
