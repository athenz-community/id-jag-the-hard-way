import crypto from "node:crypto"

export type GatewaySession = {
  idToken: string
  subject: string
  username: string
  expiresAt: number
}

class SessionStore {
  private readonly sessions = new Map<string, GatewaySession>()

  create(session: GatewaySession) {
    if (session.expiresAt <= now()) throw new Error("Cannot create an already-expired session")

    const token = randomToken()
    this.sessions.set(tokenHash(token), session)
    return token
  }

  get(token: string) {
    const key = tokenHash(token)
    const session = this.sessions.get(key)
    if (!session) return null

    if (session.expiresAt <= now()) {
      this.sessions.delete(key)
      return null
    }

    return session
  }

  delete(token: string) {
    return this.sessions.delete(tokenHash(token))
  }

  listActive() {
    const activeSessions: GatewaySession[] = []
    const currentTime = now()

    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= currentTime) {
        this.sessions.delete(key)
        continue
      }
      activeSessions.push(session)
    }

    return activeSessions
  }

  clear() {
    this.sessions.clear()
  }
}

export const sessionStore = new SessionStore()

export function randomToken() {
  return crypto.randomBytes(32).toString("base64url")
}

function tokenHash(token: string) {
  return crypto.createHash("sha256").update(token).digest("base64url")
}

function now() {
  return Math.floor(Date.now() / 1000)
}
