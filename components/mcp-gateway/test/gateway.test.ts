import assert from "node:assert/strict"
import { createServer, type RequestListener } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, describe, it } from "node:test"
import { createApp } from "../src/app.js"
import type { InternalRouterDependencies } from "../src/routes/internal.js"
import type { ProtectedRouterDependencies } from "../src/routes/protected.js"
import { AthenzAccessTokenManager } from "../src/services/athenz.js"
import { McpRegistryClient } from "../src/services/mcpRegistry.js"
import {
  clearOAuthStores,
  deriveS256CodeChallenge,
  isAllowedRedirectUri,
  verifyS256CodeChallenge,
} from "../src/utils/oauthStore.js"
import { sessionStore } from "../src/utils/sessionStore.js"

afterEach(() => {
  sessionStore.clear()
  clearOAuthStores()
})

describe("MCP Gateway", () => {
  it("publishes health and OAuth metadata", async () => {
    await withServer(async (baseUrl) => {
      const health = await fetch(`${baseUrl}/health`)
      assert.equal(health.status, 200)
      assert.deepEqual(await health.json(), { status: "ok" })

      const metadata = await fetch(`${baseUrl}/.well-known/oauth-authorization-server`)
      assert.equal(metadata.status, 200)
      const body = await metadata.json() as {
        code_challenge_methods_supported: string[]
        end_session_endpoint: string
        idp_logout_ticket_endpoint: string
      }
      assert.deepEqual(body.code_challenge_methods_supported, ["S256"])
      assert.equal(body.end_session_endpoint, "https://mcp-gateway.test/oauth/idp-logout")
      assert.equal(body.idp_logout_ticket_endpoint, "https://mcp-gateway.test/oauth/idp-logout-ticket")
    })
  })

  it("invalidates the Gateway session and creates a one-use Keycloak browser logout", async () => {
    const sessionToken = sessionStore.create({
      idToken: "stored-id-token",
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    })

    await withServer(async (baseUrl) => {
      const ticketResponse = await fetch(`${baseUrl}/oauth/idp-logout-ticket`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: sessionToken }),
      })
      assert.equal(ticketResponse.status, 200)
      assert.equal(ticketResponse.headers.get("cache-control"), "no-store")
      const rawTicketBody = await ticketResponse.text()
      assert.equal(rawTicketBody.includes("stored-id-token"), false)
      assert.equal(rawTicketBody.includes(sessionToken), false)
      const ticketBody = JSON.parse(rawTicketBody) as { logout_url: string }
      const browserLogout = new URL(ticketBody.logout_url)
      assert.equal(browserLogout.origin, "https://mcp-gateway.test")
      assert.equal(sessionStore.get(sessionToken), null)

      const logoutResponse = await fetch(
        `${baseUrl}${browserLogout.pathname}${browserLogout.search}`,
        { redirect: "manual" },
      )
      assert.equal(logoutResponse.status, 302)
      const keycloakLogout = new URL(logoutResponse.headers.get("location") ?? "")
      assert.equal(keycloakLogout.origin, "https://keycloak.test")
      assert.equal(keycloakLogout.pathname, "/realms/master/protocol/openid-connect/logout")
      assert.equal(keycloakLogout.searchParams.get("id_token_hint"), "stored-id-token")
      assert.equal(keycloakLogout.searchParams.get("client_id"), "mcp-gateway")
      assert.equal(
        keycloakLogout.searchParams.get("post_logout_redirect_uri"),
        "https://mcp-gateway.test/oauth/idp-logout/complete",
      )

      const reusedTicket = await fetch(
        `${baseUrl}${browserLogout.pathname}${browserLogout.search}`,
        { redirect: "manual" },
      )
      assert.equal(reusedTicket.status, 400)
    })
  })

  it("reports sanitized OAuth session and Athenz cache status to authenticated Hub callers", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 300
    const sessionToken = sessionStore.create({
      idToken: "stored-id-token-must-not-leak",
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt,
    })

    await withServer(async (baseUrl) => {
      const unauthorized = await fetch(`${baseUrl}/internal/cache-status`)
      assert.equal(unauthorized.status, 401)

      const response = await fetch(`${baseUrl}/internal/cache-status`, {
        headers: { authorization: "Bearer registry-secret" },
      })
      assert.equal(response.status, 200)
      assert.equal(response.headers.get("cache-control"), "no-store")
      const rawBody = await response.text()
      const body = JSON.parse(rawBody) as {
        sessionCount: number
        sessions: Array<{
          username: string
          subject: string
          expiresAt: string
          athenzAccessTokens: { entries: Array<{ scope: string }> }
        }>
      }
      assert.equal(body.sessionCount, 1)
      assert.equal(body.sessions[0].username, "idjag-learner")
      assert.equal(body.sessions[0].subject, "keycloak-subject")
      assert.equal(body.sessions[0].expiresAt, new Date(expiresAt * 1000).toISOString())
      assert.equal(body.sessions[0].athenzAccessTokens.entries[0].scope, "api:role.docs-getter")
      assert.equal(rawBody.includes("stored-id-token-must-not-leak"), false)
      assert.equal(rawBody.includes(sessionToken), false)
      assert.equal(rawBody.includes("issued-athenz-at-must-not-leak"), false)
    }, {}, {
      registryToken: "registry-secret",
      getAccessTokenCacheStatus: () => ({
        entryCount: 1,
        usableEntryCount: 1,
        refreshRequiredEntryCount: 0,
        expiredEntryCount: 0,
        expirySkewSeconds: 60,
        entries: [{
          scope: "api:role.docs-getter",
          cachedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          status: "valid",
        }],
      }),
    })
  })

  it("registers a loopback OAuth client and starts a PKCE login", async () => {
    await withServer(async (baseUrl) => {
      const registration = await fetch(`${baseUrl}/oauth/register`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["http://127.0.0.1:43123/callback"] }),
      })
      assert.equal(registration.status, 201)
      const client = await registration.json() as { client_id: string }
      const verifier = "test-verifier-with-enough-random-looking-characters"
      const parameters = new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "http://127.0.0.1:43123/callback",
        response_type: "code",
        state: "client-state",
        code_challenge: deriveS256CodeChallenge(verifier),
        code_challenge_method: "S256",
      })
      const authorization = await fetch(`${baseUrl}/oauth/authorize?${parameters}`, { redirect: "manual" })
      assert.equal(authorization.status, 302)
      assert.match(authorization.headers.get("location") ?? "", /\/protocol\/openid-connect\/auth/)
    })
  })

  it("requires a gateway session before MCP access", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/mcp/k8s-docs-server`, { method: "POST" })
      assert.equal(response.status, 401)
      assert.match(response.headers.get("www-authenticate") ?? "", /oauth-protected-resource\/mcp\/k8s-docs-server/)
    })
  })

  it("forwards MCP discovery without requesting an Athenz access token", async () => {
    let receivedAuthorization = "not-observed"
    let receivedBody = ""

    await withHttpServer(async (request, response) => {
      receivedAuthorization = request.headers.authorization ?? ""
      for await (const chunk of request) receivedBody += chunk.toString()
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }))
    }, async (coreMcpProxyUrl) => {
      const sessionToken = sessionStore.create({
        idToken: "stored-id-token",
        subject: "keycloak-subject",
        username: "idjag-learner",
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      })

      await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mcp/k8s-docs-server`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${sessionToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
        })

        assert.equal(response.status, 200)
      }, {
        resolveRoute: async () => ({
          proxyUrl: `${coreMcpProxyUrl}/mcp/k8s-docs-server`,
          accessScope: "api:role.mcp-accessor api:role.docs-getter",
        }),
        getAccessToken: async () => {
          throw new Error("Public MCP discovery must not request an Athenz access token")
        },
      })

      assert.equal(receivedAuthorization, "")
      assert.deepEqual(JSON.parse(receivedBody), { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
    })
  })

  it("replaces the opaque session bearer with the selected tool's Athenz token", async () => {
    let receivedPath = ""
    let receivedAuthorization = ""
    let receivedSessionId = ""
    let receivedBody = ""

    await withHttpServer(async (request, response) => {
      receivedPath = request.url ?? ""
      receivedAuthorization = request.headers.authorization ?? ""
      receivedSessionId = String(request.headers["mcp-session-id"] ?? "")
      for await (const chunk of request) receivedBody += chunk.toString()
      response.statusCode = 200
      response.setHeader("content-type", "application/json")
      response.setHeader("mcp-session-id", "upstream-session")
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }))
    }, async (coreMcpProxyUrl) => {
      const expiresAt = Math.floor(Date.now() / 1000) + 300
      const sessionToken = sessionStore.create({
        idToken: "stored-id-token",
        subject: "keycloak-subject",
        username: "idjag-learner",
        expiresAt,
      })
      let tokenRequest: { idToken: string; scope: string } | undefined

      await withServer(async (baseUrl) => {
        const response = await fetch(`${baseUrl}/mcp/k8s-docs-server?trace=1`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${sessionToken}`,
            "content-type": "application/json",
            "mcp-session-id": "client-session",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "tools/call",
            params: { name: "get_k8s_docs", arguments: {} },
          }),
        })

        assert.equal(response.status, 200)
        assert.equal(response.headers.get("mcp-session-id"), "upstream-session")
        assert.equal(response.headers.get("x-mcp-gateway-server-id"), "k8s-docs-server")
      }, {
        accessScope: "api:role.mcp-accessor api:role.docs-getter",
        resolveRoute: async () => ({
          proxyUrl: `${coreMcpProxyUrl}/mcp/k8s-docs-server`,
          accessScope: "api:role.mcp-accessor api:role.docs-getter",
          toolScopes: {
            get_k8s_docs: "api:role.docs-getter api:role.mcp-accessor",
            post_k8s_doc: "api:role.docs-poster api:role.mcp-accessor",
            delete_k8s_doc: "api:role.docs-deleter api:role.mcp-accessor",
          },
        }),
        getAccessToken: async (session, scope) => {
          tokenRequest = { idToken: session.idToken, scope }
          return "user-scoped-athenz-at"
        },
      })

      assert.equal(receivedPath, "/mcp/k8s-docs-server?trace=1")
      assert.equal(receivedAuthorization, "Bearer user-scoped-athenz-at")
      assert.equal(receivedSessionId, "client-session")
      assert.deepEqual(JSON.parse(receivedBody), {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "get_k8s_docs", arguments: {} },
      })
      assert.deepEqual(tokenRequest, {
        idToken: "stored-id-token",
        scope: "api:role.docs-getter api:role.mcp-accessor",
      })
    })
  })

  it("selects GET, POST, and DELETE access scopes from tools/call params.name", async () => {
    await withHttpServer((_request, response) => {
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [] } }))
    }, async (coreMcpProxyUrl) => {
      const sessionToken = sessionStore.create({
        idToken: "stored-id-token",
        subject: "keycloak-subject",
        username: "idjag-learner",
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      })
      const requestedScopes: string[] = []

      await withServer(async (baseUrl) => {
        for (const toolName of ["get_k8s_docs", "post_k8s_doc", "delete_k8s_doc"]) {
          const response = await fetch(`${baseUrl}/mcp/k8s-docs-server`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${sessionToken}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tools/call",
              params: { name: toolName, arguments: {} },
            }),
          })
          assert.equal(response.status, 200)
        }
      }, {
        resolveRoute: async () => ({
          proxyUrl: `${coreMcpProxyUrl}/mcp/k8s-docs-server`,
          accessScope: "api:role.docs-getter api:role.mcp-accessor",
          toolScopes: {
            get_k8s_docs: "api:role.docs-getter api:role.mcp-accessor",
            post_k8s_doc: "api:role.docs-poster api:role.mcp-accessor",
            delete_k8s_doc: "api:role.docs-deleter api:role.mcp-accessor",
          },
        }),
        getAccessToken: async (_session, scope) => {
          requestedScopes.push(scope)
          return "user-scoped-athenz-at"
        },
      })

      assert.deepEqual(requestedScopes, [
        "api:role.docs-getter api:role.mcp-accessor",
        "api:role.docs-poster api:role.mcp-accessor",
        "api:role.docs-deleter api:role.mcp-accessor",
      ])
    })
  })

  it("rejects unmapped and malformed tools/call without requesting a fallback token", async () => {
    const sessionToken = sessionStore.create({
      idToken: "stored-id-token",
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    })
    let accessTokenRequests = 0

    await withServer(async (baseUrl) => {
      const unmapped = await fetch(`${baseUrl}/mcp/k8s-docs-server`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "unconfigured_tool", arguments: {} },
        }),
      })
      assert.equal(unmapped.status, 403)
      assert.equal((await unmapped.json() as { error: string }).error, "tool_scope_not_configured")

      const malformed = await fetch(`${baseUrl}/mcp/k8s-docs-server`, {
        method: "POST",
        headers: { authorization: `Bearer ${sessionToken}`, "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: {} }),
      })
      assert.equal(malformed.status, 400)
      assert.equal((await malformed.json() as { error: string }).error, "invalid_tool_call")
    }, {
      resolveRoute: async () => ({
        proxyUrl: "http://core-mcp-proxy.test/mcp/k8s-docs-server",
        accessScope: "api:role.docs-getter api:role.mcp-accessor",
        toolScopes: { get_k8s_docs: "api:role.docs-getter api:role.mcp-accessor" },
      }),
      getAccessToken: async () => {
        accessTokenRequests += 1
        return "must-not-be-issued"
      },
    })

    assert.equal(accessTokenRequests, 0)
  })

  it("exchanges ID token to ID-JAG and AT once per session and scope", async () => {
    const forms: URLSearchParams[] = []
    const manager = new AthenzAccessTokenManager(async (form) => {
      forms.push(form)
      return forms.length === 1
        ? { access_token: "issued-id-jag", expires_in: 300 }
        : { access_token: "issued-athenz-at", expires_in: 300 }
    })
    const session = {
      idToken: "stored-id-token",
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt: Math.floor(Date.now() / 1000) + 300,
    }

    const [first, concurrent] = await Promise.all([
      manager.getAccessToken(session, "api:role.mcp-accessor api:role.docs-getter"),
      manager.getAccessToken(session, "api:role.docs-getter api:role.mcp-accessor"),
    ])
    const cached = await manager.getAccessToken(session, "api:role.mcp-accessor api:role.docs-getter")

    assert.equal(first, "issued-athenz-at")
    assert.equal(concurrent, "issued-athenz-at")
    assert.equal(cached, "issued-athenz-at")
    assert.equal(forms.length, 2)
    assert.equal(forms[0].get("subject_token"), "stored-id-token")
    assert.equal(forms[0].get("requested_token_type"), "urn:ietf:params:oauth:token-type:id-jag")
    assert.equal(forms[1].get("assertion"), "issued-id-jag")
    assert.equal(forms[1].get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer")
    const cacheStatus = manager.getCacheStatus(session)
    assert.equal(cacheStatus.entryCount, 1)
    assert.equal(cacheStatus.entries[0].scope, "api:role.docs-getter api:role.mcp-accessor")
    assert.equal(JSON.stringify(cacheStatus).includes("issued-athenz-at"), false)
  })

  it("resolves and caches route metadata from the MCP Hub API", async () => {
    let registryRequests = 0
    await withHttpServer((request, response) => {
      registryRequests += 1
      assert.equal(request.headers.authorization, "Bearer registry-secret")
      response.setHeader("content-type", "application/json")
      response.end(JSON.stringify({
        servers: [{
          routeId: "k8s-docs-server",
          proxyUrl: "http://core-mcp-proxy.mcp-hub:8080/mcp/k8s-docs-server",
          accessScope: "api:role.mcp-accessor api:role.docs-getter",
          toolScopes: {
            get_k8s_docs: "api:role.docs-getter api:role.mcp-accessor",
            post_k8s_doc: "api:role.docs-poster api:role.mcp-accessor",
          },
        }],
      }))
    }, async (registryOrigin) => {
      const registry = new McpRegistryClient(`${registryOrigin}/api/mcp-servers`, "registry-secret", 5000)
      const first = await registry.resolveRoute("k8s-docs-server")
      const cached = await registry.resolveRoute("k8s-docs-server")

      assert.deepEqual(first, {
        proxyUrl: "http://core-mcp-proxy.mcp-hub:8080/mcp/k8s-docs-server",
        accessScope: "api:role.mcp-accessor api:role.docs-getter",
        toolScopes: {
          get_k8s_docs: "api:role.docs-getter api:role.mcp-accessor",
          post_k8s_doc: "api:role.docs-poster api:role.mcp-accessor",
        },
      })
      assert.deepEqual(cached, first)
      assert.equal(registryRequests, 1)
    })
  })

  it("resolves an opaque bearer without exposing the stored ID token", async () => {
    const expiresAt = Math.floor(Date.now() / 1000) + 300
    const token = sessionStore.create({
      idToken: "stored-id-token",
      subject: "keycloak-subject",
      username: "idjag-learner",
      expiresAt,
    })

    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/session`, {
        headers: { authorization: `Bearer ${token}` },
      })
      assert.equal(response.status, 200)
      const body = await response.json() as Record<string, unknown>
      assert.equal(body.username, "idjag-learner")
      assert.equal(body.expires_at, expiresAt)
      assert.equal("idToken" in body, false)
    })
  })

  it("validates PKCE and limits plaintext redirects to loopback", () => {
    const verifier = "test-verifier-with-enough-random-looking-characters"
    const challenge = deriveS256CodeChallenge(verifier)
    assert.equal(verifyS256CodeChallenge(verifier, challenge), true)
    assert.equal(verifyS256CodeChallenge("wrong-verifier", challenge), false)
    assert.equal(isAllowedRedirectUri("http://127.0.0.1:43123/callback"), true)
    assert.equal(isAllowedRedirectUri("https://client.example/callback"), true)
    assert.equal(isAllowedRedirectUri("http://client.example/callback"), false)
  })
})

async function withServer(
  run: (baseUrl: string) => Promise<void>,
  dependencies: Partial<ProtectedRouterDependencies> = {},
  internalDependencies: Partial<InternalRouterDependencies> = {},
) {
  const server = createApp(dependencies, internalDependencies).listen(0, "127.0.0.1")
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve)
    server.once("error", reject)
  })

  try {
    const address = server.address() as AddressInfo
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

async function withHttpServer(listener: RequestListener, run: (baseUrl: string) => Promise<void>) {
  const server = createServer(listener).listen(0, "127.0.0.1")
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve)
    server.once("error", reject)
  })

  try {
    const address = server.address() as AddressInfo
    await run(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}
