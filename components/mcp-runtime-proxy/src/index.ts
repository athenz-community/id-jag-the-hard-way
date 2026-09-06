import { readFile } from "node:fs/promises"
import {
  createAthenzAccessTokenVerifier,
  createRemoteJwksKeyResolver,
} from "./auth.ts"
import { createRuntimeProxyServer } from "./proxy.ts"

const port = parsePort(process.env.PORT ?? "8082")
const target = new URL(process.env.MCP_TARGET_URL ?? "http://127.0.0.1:8080")
const expectedAudience = requiredEnvironment("ATHENZ_EXPECTED_AUDIENCE")
const requiredScope = requiredEnvironment("ATHENZ_REQUIRED_SCOPE")
const jwksUrl = new URL(
  process.env.ATHENZ_JWKS_URL
    ?? "https://athenz-zts-server.athenz:4443/zts/v1/oauth2/keys?rfc=true",
)
const allowInsecureHttp = process.env.ATHENZ_JWKS_ALLOW_INSECURE_HTTP === "true"
const jwksCaPath = process.env.ATHENZ_JWKS_CA_PATH ?? "/var/run/athenz/ca.crt"
const ca = jwksUrl.protocol === "https:" ? await readFile(jwksCaPath) : undefined
const accessTokenVerifier = createAthenzAccessTokenVerifier({
  expectedAudience,
  requiredScope,
  resolveSigningKey: createRemoteJwksKeyResolver({
    allowInsecureHttp,
    ca,
    cacheTtlMs: positiveInteger(process.env.ATHENZ_JWKS_CACHE_TTL_SECONDS ?? "300") * 1000,
    jwksUrl,
  }),
})
const server = createRuntimeProxyServer(target, accessTokenVerifier)

server.listen(port, "0.0.0.0", () => {
  console.log(`mcp-runtime-proxy listening on 0.0.0.0:${port}`)
  console.log(`forwarding MCP requests to ${target.origin}${target.pathname}`)
  console.log(`requiring Athenz audience ${expectedAudience} and scope ${requiredScope}`)
})

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}

function parsePort(value: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid PORT ${JSON.stringify(value)}`)
  }
  return parsed
}

function positiveInteger(value: string) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid positive integer ${JSON.stringify(value)}`)
  return parsed
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
