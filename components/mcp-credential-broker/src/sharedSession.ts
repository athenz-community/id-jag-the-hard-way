import crypto from "node:crypto"
import { constants } from "node:fs"
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  unlink,
} from "node:fs/promises"
import os from "node:os"
import path from "node:path"

export type GatewayCredential = {
  version: 1
  issuer: string
  accessToken: string
  tokenType: "Bearer"
  expiresAt: number
}

type SharedSessionStoreOptions = {
  expirySkewMs?: number
  lockStaleMs?: number
  maxWaitMs?: number
  pollIntervalMs?: number
  now?: () => number
  sleep?: (milliseconds: number) => Promise<void>
  onWait?: () => void
}

type SessionPaths = {
  credential: string
  lock: string
}

type LockOwner = {
  nonce: string
  pid: number
  createdAt: number
}

const DEFAULT_EXPIRY_SKEW_MS = 60_000
const DEFAULT_LOCK_STALE_MS = 10 * 60_000
const DEFAULT_MAX_WAIT_MS = 11 * 60_000
const DEFAULT_POLL_INTERVAL_MS = 150

export class SharedSessionStore {
  private readonly expirySkewMs: number
  private readonly lockStaleMs: number
  private readonly maxWaitMs: number
  private readonly pollIntervalMs: number
  private readonly now: () => number
  private readonly sleep: (milliseconds: number) => Promise<void>
  private readonly onWait?: () => void

  constructor(
    readonly cacheDirectory = defaultCacheDirectory(),
    options: SharedSessionStoreOptions = {},
  ) {
    this.expirySkewMs = options.expirySkewMs ?? DEFAULT_EXPIRY_SKEW_MS
    this.lockStaleMs = options.lockStaleMs ?? DEFAULT_LOCK_STALE_MS
    this.maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
    this.onWait = options.onWait
  }

  async getOrCreate(
    issuer: string,
    acquireCredential: () => Promise<GatewayCredential>,
  ): Promise<GatewayCredential> {
    await ensurePrivateDirectory(this.cacheDirectory)
    const paths = sessionPaths(this.cacheDirectory, issuer)
    const deadline = Date.now() + this.maxWaitMs
    let waitingReported = false

    while (Date.now() <= deadline) {
      const cached = await this.readUsable(paths.credential, issuer)
      if (cached) return cached

      const owner = await this.tryAcquireLock(paths.lock)
      if (owner) {
        try {
          const afterLock = await this.readUsable(paths.credential, issuer)
          if (afterLock) return afterLock

          const credential = await acquireCredential()
          assertCredential(credential, issuer, this.now())
          await writeCredentialAtomically(paths.credential, credential)
          return credential
        } finally {
          await releaseOwnedLock(paths.lock, owner.nonce)
        }
      }

      if (!waitingReported) {
        waitingReported = true
        this.onWait?.()
      }
      await removeStaleLock(paths.lock, this.now(), this.lockStaleMs)
      await this.sleep(this.pollIntervalMs)
    }

    throw new Error("Timed out waiting for another MCP connector to finish browser authentication")
  }

  async invalidate(issuer: string, accessToken: string): Promise<boolean> {
    await ensurePrivateDirectory(this.cacheDirectory)
    const paths = sessionPaths(this.cacheDirectory, issuer)
    const deadline = Date.now() + this.maxWaitMs

    while (Date.now() <= deadline) {
      const owner = await this.tryAcquireLock(paths.lock)
      if (owner) {
        try {
          const credential = await readCredential(paths.credential)
          if (credential?.issuer === issuer && credential.accessToken === accessToken) {
            await unlinkIfPresent(paths.credential)
            return true
          }
          return false
        } finally {
          await releaseOwnedLock(paths.lock, owner.nonce)
        }
      }

      await removeStaleLock(paths.lock, this.now(), this.lockStaleMs)
      await this.sleep(this.pollIntervalMs)
    }

    throw new Error("Timed out waiting to invalidate a rejected Gateway session")
  }

  async clearAll(): Promise<GatewayCredential[]> {
    await ensurePrivateDirectory(this.cacheDirectory)
    const entries = await readdir(this.cacheDirectory, { withFileTypes: true })
    const cleared: GatewayCredential[] = []

    for (const entry of entries) {
      if (!entry.isFile() || !/^[a-f0-9]{64}\.json$/.test(entry.name)) continue

      const file = path.join(this.cacheDirectory, entry.name)
      const credential = await readCredential(file)
      if (!credential || sessionPaths(this.cacheDirectory, credential.issuer).credential !== file) {
        await unlinkIfPresent(file)
        continue
      }

      if (await this.invalidate(credential.issuer, credential.accessToken)) {
        cleared.push(credential)
      }
    }

    return cleared
  }

  private async readUsable(file: string, issuer: string) {
    const credential = await readCredential(file)
    if (!credential || credential.issuer !== issuer) return null
    if (credential.expiresAt <= this.now() + this.expirySkewMs) return null
    return credential
  }

  private async tryAcquireLock(file: string): Promise<LockOwner | null> {
    const owner = {
      nonce: crypto.randomBytes(18).toString("base64url"),
      pid: process.pid,
      createdAt: this.now(),
    }

    try {
      const handle = await open(file, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
      try {
        await handle.writeFile(JSON.stringify(owner), "utf8")
        await handle.sync()
      } finally {
        await handle.close()
      }
      return owner
    } catch (error) {
      if (isFileExistsError(error)) return null
      throw error
    }
  }
}

export function defaultCacheDirectory() {
  const override = process.env.IDTHW_MCP_CREDENTIAL_CACHE_DIR?.trim()
  return override || path.join(os.homedir(), ".idthw", "mcp-credential-broker")
}

export function sessionPaths(cacheDirectory: string, issuer: string): SessionPaths {
  const key = crypto.createHash("sha256").update(issuer).digest("hex")
  return {
    credential: path.join(cacheDirectory, `${key}.json`),
    lock: path.join(cacheDirectory, `${key}.lock`),
  }
}

async function ensurePrivateDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const status = await lstat(directory)
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error(`Credential cache path is not a private directory: ${directory}`)
  }
  if (process.platform !== "win32" && (status.mode & 0o077) !== 0) {
    throw new Error(`Credential cache directory must not be accessible by group or other users: ${directory}`)
  }
  await chmod(directory, 0o700)
}

async function readCredential(file: string): Promise<GatewayCredential | null> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<GatewayCredential>
    if (
      parsed.version !== 1
      || typeof parsed.issuer !== "string"
      || typeof parsed.accessToken !== "string"
      || parsed.accessToken.length === 0
      || parsed.tokenType !== "Bearer"
      || typeof parsed.expiresAt !== "number"
      || !Number.isFinite(parsed.expiresAt)
    ) {
      return null
    }
    return parsed as GatewayCredential
  } catch (error) {
    if (isFileMissingError(error) || error instanceof SyntaxError) return null
    throw error
  }
}

async function writeCredentialAtomically(file: string, credential: GatewayCredential) {
  const temporaryFile = `${file}.${process.pid}.${crypto.randomBytes(8).toString("hex")}.tmp`
  let handle
  try {
    handle = await open(temporaryFile, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600)
    await handle.writeFile(`${JSON.stringify(credential)}\n`, "utf8")
    await handle.sync()
    await handle.close()
    handle = undefined
    await rename(temporaryFile, file)
    await chmod(file, 0o600)
  } finally {
    await handle?.close().catch(() => undefined)
    await unlinkIfPresent(temporaryFile)
  }
}

async function releaseOwnedLock(file: string, nonce: string) {
  try {
    const owner = JSON.parse(await readFile(file, "utf8")) as Partial<LockOwner>
    if (owner.nonce === nonce) await unlinkIfPresent(file)
  } catch (error) {
    if (!isFileMissingError(error) && !(error instanceof SyntaxError)) throw error
  }
}

async function removeStaleLock(file: string, now: number, staleAfterMs: number) {
  try {
    const status = await lstat(file)
    if (status.isSymbolicLink() || now - status.mtimeMs > staleAfterMs) await unlinkIfPresent(file)
  } catch (error) {
    if (!isFileMissingError(error)) throw error
  }
}

function assertCredential(credential: GatewayCredential, issuer: string, now: number) {
  if (
    credential.version !== 1
    || credential.issuer !== issuer
    || credential.tokenType !== "Bearer"
    || !credential.accessToken
    || !Number.isFinite(credential.expiresAt)
    || credential.expiresAt <= now
  ) {
    throw new Error("OAuth server returned an invalid or already expired Gateway credential")
  }
}

async function unlinkIfPresent(file: string) {
  try {
    await unlink(file)
  } catch (error) {
    if (!isFileMissingError(error)) throw error
  }
}

function isFileExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "EEXIST"
}

function isFileMissingError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT"
}
