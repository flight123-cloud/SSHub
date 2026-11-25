import iconv from 'iconv-lite'
import type { Encoding } from '../shared/types'

/** iconv 编码名；GBK 用其超集 GB18030 解码，兼容性更好 */
const ICONV: Record<Encoding, string> = { utf8: 'utf8', gbk: 'gb18030', big5: 'big5' }

export function decode(buf: Buffer, enc: Encoding): string {
  return enc === 'utf8' ? buf.toString('utf8') : iconv.decode(buf, ICONV[enc])
}

export function encode(text: string, enc: Encoding): Buffer {
  return enc === 'utf8' ? Buffer.from(text, 'utf8') : iconv.encode(text, ICONV[enc])
}

/** 流式解码（终端输出可能在多字节字符中间被截断） */
export function streamDecoder(enc: Encoding): { write(buf: Buffer): string } {
  if (enc === 'utf8') {
    const d = new TextDecoder('utf-8')
    return { write: (b) => d.decode(b, { stream: true }) }
  }
  const d = iconv.getDecoder(ICONV[enc])
  return { write: (b) => d.write(b) }
}

/** 字节是否是合法的 UTF-8 */
export function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return true
  } catch {
    return false
  }
}

/** 粗略判断二进制文件：前 8KB 内出现 NUL 字节 */
export function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

/** FTP 控制连接用 latin1 收发原始字节，再按服务器编码转换（basic-ftp 本身只支持 Node 内置编码） */
export function toWire(s: string, enc: Encoding): string {
  return enc === 'utf8' ? s : encode(s, enc).toString('latin1')
}
export function fromWire(s: string, enc: Encoding): string {
  return enc === 'utf8' ? s : decode(Buffer.from(s, 'latin1'), enc)
}
