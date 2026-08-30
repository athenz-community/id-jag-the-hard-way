import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { it } from "node:test"
import { createAuthenticatedFetch } from "../src/authenticatedFetch.js"
import type { OAuthEndpoints } from "../src/oauth.js"
import { SharedSessionStore } from "../src/sharedSession.js"

it("invalidates a rejected session and retries once with the shared replacement", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "idthw-mcp-broker-fetch-test-"))
  try {
    const endpoints: OAuthEndpoints = {
      issuer: "https://gateway.example",
      authorizationEndpoint: "https://gateway.example/oauth/authorize",
      tokenEndpoint: "https://gateway.example/oauth/token",
      registrationEndpoint: "https://gateway.example/oauth/register",
    }
    const store = new SharedSessionStore(directory)
    let acquisitions = 0
    const authorizationHeaders: string[] = []
    const authenticatedFetch = createAuthenticatedFetch({
      endpoints,
      sessionStore: store,
      acquireCredential: async () => ({
        version: 1,
        issuer: endpoints.issuer,
        accessToken: `session-${++acquisitions}`,
        tokenType: "Bearer",
        expiresAt: Date.now() + 300_000,
      }),
      fetch: async (_url, init) => {
        authorizationHeaders.push(new Headers(init?.headers).get("authorization") ?? "")
        return new Response(null, { status: authorizationHeaders.length === 1 ? 401 : 200 })
      },
    })

    const response = await authenticatedFetch("https://gateway.example/mcp/confluence", { method: "POST" })

    assert.equal(response.status, 200)
    assert.equal(acquisitions, 2)
    assert.deepEqual(authorizationHeaders, ["Bearer session-1", "Bearer session-2"])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
