import { app, safeStorage } from 'electron'
import { randomUUID } from 'crypto'
import fs from 'fs'
import path from 'path'
import type { SessionInfo, SessionInput, AuthType, Protocol, FtpOptions } from '../shared/types'

interface StoredSession {
  id: string
  /** 旧版本保存的会话没有该字段，视为 ssh */
  protocol?: Protocol
  ftp?: FtpOptions
  name: string
  group: string
  host: string
  port: number
  username: string
  authType: AuthType
  privateKeyPath?: string
  /** 加密后的密码（base64） */
  password?: string
  passphrase?: string
  createdAt: number
  lastUsedAt?: number
}

function dataFile(name: string): string {
  return path.join(app.getPath('userData'), name)
}

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return fallback
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

/** 使用系统钥匙串（macOS Keychain）派生的密钥加密敏感信息 */
async function encrypt(plain: string): Promise<string> {
  if (await safeStorage.isAsyncEncryptionAvailable()) {
    return 'enc:' + (await safeStorage.encryptStringAsync(plain)).toString('base64')
  }
  return 'b64:' + Buffer.from(plain, 'utf8').toString('base64')
}

async function decrypt(value: string | undefined): Promise<string | undefined> {
  if (!value) return undefined
  try {
    if (value.startsWith('enc:')) {
      return (await safeStorage.decryptStringAsync(Buffer.from(value.slice(4), 'base64'))).result
    }
    if (value.startsWith('b64:')) {
      return Buffer.from(value.slice(4), 'base64').toString('utf8')
    }
  } catch {
    return undefined
  }
  return undefined
}

const SESSIONS_FILE = (): string => dataFile('sessions.json')

function loadAll(): StoredSession[] {
  return readJson<StoredSession[]>(SESSIONS_FILE(), [])
}

function saveAll(list: StoredSession[]): void {
  writeJson(SESSIONS_FILE(), list)
}

function toInfo(s: StoredSession): SessionInfo {
  return {
    id: s.id,
    protocol: s.protocol ?? 'ssh',
    ftp: s.ftp,
    name: s.name,
    group: s.group,
    host: s.host,
    port: s.port,
    username: s.username,
    authType: s.authType,
    privateKeyPath: s.privateKeyPath,
    hasPassword: !!s.password,
    hasPassphrase: !!s.passphrase,
    createdAt: s.createdAt,
    lastUsedAt: s.lastUsedAt
  }
}

export const sessionStore = {
  list(): SessionInfo[] {
    return loadAll().map(toInfo)
  },

  async save(input: SessionInput): Promise<SessionInfo> {
    // 先加密（异步），再读写文件，避免并发写入丢失
    const encPassword = input.password ? await encrypt(input.password) : undefined
    const encPassphrase = input.passphrase ? await encrypt(input.passphrase) : undefined
    const list = loadAll()
    let s = input.id ? list.find((x) => x.id === input.id) : undefined
    if (!s) {
      s = {
        id: randomUUID(),
        name: '',
        group: '',
        host: '',
        port: 22,
        username: '',
        authType: 'password',
        createdAt: Date.now()
      }
      list.push(s)
    }
    s.protocol = input.protocol
    s.ftp = input.protocol === 'ftp' ? input.ftp : undefined
    s.name = input.name.trim() || `${input.username}@${input.host}`
    s.group = input.group.trim()
    s.host = input.host.trim()
    s.port = Number(input.port) || (input.protocol === 'ftp' ? 21 : 22)
    s.username = input.username.trim()
    s.authType = input.authType
    s.privateKeyPath = input.privateKeyPath?.trim() || undefined
    if (input.password !== undefined) s.password = encPassword
    if (input.passphrase !== undefined) s.passphrase = encPassphrase
    saveAll(list)
    return toInfo(s)
  },

  remove(id: string): void {
    saveAll(loadAll().filter((s) => s.id !== id))
  },

  duplicate(id: string): SessionInfo | undefined {
    const list = loadAll()
    const src = list.find((s) => s.id === id)
    if (!src) return undefined
    const copy: StoredSession = { ...src, id: randomUUID(), name: src.name + ' 副本', createdAt: Date.now() }
    list.push(copy)
    saveAll(list)
    return toInfo(copy)
  },

  touch(id: string): void {
    const list = loadAll()
    const s = list.find((x) => x.id === id)
    if (s) {
      s.lastUsedAt = Date.now()
      saveAll(list)
    }
  },

  /** 仅主进程内部使用：取出解密后的凭据 */
  async getSecret(
    id: string
  ): Promise<
    (StoredSession & { protocol: Protocol; plainPassword?: string; plainPassphrase?: string }) | undefined
  > {
    const s = loadAll().find((x) => x.id === id)
    if (!s) return undefined
    return { ...s, protocol: s.protocol ?? 'ssh', plainPassword: await decrypt(s.password), plainPassphrase: await decrypt(s.passphrase) }
  }
}

/** 已知主机指纹（类似 ~/.ssh/known_hosts） */
const KNOWN_HOSTS_FILE = (): string => dataFile('known_hosts.json')

export const knownHosts = {
  get(hostPort: string): string | undefined {
    return readJson<Record<string, string>>(KNOWN_HOSTS_FILE(), {})[hostPort]
  },
  set(hostPort: string, fingerprint: string): void {
    const all = readJson<Record<string, string>>(KNOWN_HOSTS_FILE(), {})
    all[hostPort] = fingerprint
    writeJson(KNOWN_HOSTS_FILE(), all)
  }
}
