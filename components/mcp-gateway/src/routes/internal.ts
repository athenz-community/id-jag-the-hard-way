import { timingSafeEqual } from "node:crypto"
import { Router } from "express"
import { MCP_HUB_REGISTRY_TOKEN } from "../config/env.js"
import {
  athenzAccessTokenManager,
  type AthenzAccessTokenCacheStatus,
} from "../services/athenz.js"
import { sessionStore, type GatewaySession } from "../utils/sessionStore.js"

const SESSION_EXPIRY_SKEW_SECONDS = 60

export type InternalRouterDependencies = {
  registryToken: string | undefined
  listActiveSessions: () => GatewaySession[]
  getAccessTokenCacheStatus: (session: GatewaySession) => AthenzAccessTokenCacheStatus
}

const defaultDependencies: InternalRouterDependencies = {
  registryToken: MCP_HUB_REGISTRY_TOKEN,
  listActiveSessions: () => sessionStore.listActive(),
  getAccessTokenCacheStatus: (session) => athenzAccessTokenManager.getCacheStatus(session),
}

export function createInternalRouter(overrides: Partial<InternalRouterDependencies> = {}) {
  const dependencies = { ...defaultDependencies, ...overrides }
  const router = Router()

  router.get("/internal/cache-status", (request, response) => {
    response.setHeader("cache-control", "no-store")
    if (!isAuthorized(request.headers.authorization, dependencies.registryToken)) {
      response.status(401).json({ error: "Authentication required" })
      return
    }

    const now = Date.now()
    const sessions = dependencies.listActiveSessions().map((session) => {
      const status = session.expiresAt * 1000 <= now + SESSION_EXPIRY_SKEW_SECONDS * 1000
        ? "refresh-required" as const
        : "valid" as const
      return {
        username: session.username,
        subject: session.subject,
        expiresAt: new Date(session.expiresAt * 1000).toISOString(),
        status,
        athenzAccessTokens: dependencies.getAccessTokenCacheStatus(session),
      }
    })
    const refreshRequiredSessionCount = sessions.filter((session) => session.status === "refresh-required").length

    response.json({
      generatedAt: new Date(now).toISOString(),
      sessionCount: sessions.length,
      validSessionCount: sessions.length - refreshRequiredSessionCount,
      refreshRequiredSessionCount,
      expirySkewSeconds: SESSION_EXPIRY_SKEW_SECONDS,
      sessions,
    })
  })

  return router
}

function isAuthorized(authorization: string | undefined, expectedToken: string | undefined) {
  if (!expectedToken || !authorization?.startsWith("Bearer ")) return false
  const supplied = Buffer.from(authorization.slice("Bearer ".length))
  const expected = Buffer.from(expectedToken)
  return supplied.length === expected.length && timingSafeEqual(supplied, expected)
}
