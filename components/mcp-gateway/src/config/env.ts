import path from "node:path"

function withoutTrailingSlash(value: string) {
  return value.replace(/\/+$/, "")
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function booleanValue(value: string | undefined, fallback = false) {
  if (value === undefined) return fallback
  return value === "true"
}

const allowInsecureHttp = booleanValue(process.env.ALLOW_INSECURE_HTTP)

function requiredUrl(name: string, options: { allowInternalHttp?: boolean } = {}) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} must be set to a full externally reachable URL`)
  const url = new URL(value)
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1"
  if (url.protocol !== "https:" && !loopback && !options.allowInternalHttp && !allowInsecureHttp) {
    throw new Error(`${name} must use HTTPS unless it is a loopback development URL`)
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${name} must use HTTP or HTTPS`)
  return withoutTrailingSlash(url.toString())
}

function requiredString(name: string, fallback?: string) {
  const value = (process.env[name] ?? fallback ?? "").trim()
  if (!value) throw new Error(`${name} must not be empty`)
  return value
}

export const PORT = positiveInteger(process.env.PORT, 3103)
export const PUBLIC_BASE_URL = requiredUrl("PUBLIC_BASE_URL")
export const KEYCLOAK_PUBLIC_URL = requiredUrl("KEYCLOAK_PUBLIC_URL")
export const KEYCLOAK_URL = process.env.KEYCLOAK_URL ? requiredUrl("KEYCLOAK_URL") : KEYCLOAK_PUBLIC_URL
export const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? "master"
export const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "mcp-gateway"
export const KEYCLOAK_CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET
export const KEYCLOAK_ISSUER = withoutTrailingSlash(
  process.env.KEYCLOAK_ISSUER ?? `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}`,
)
export const MCP_HUB_REGISTRY_URL = process.env.MCP_HUB_REGISTRY_URL
  ? requiredUrl("MCP_HUB_REGISTRY_URL", { allowInternalHttp: true })
  : "http://127.0.0.1:3102/api/mcp-servers"
export const MCP_HUB_REGISTRY_TOKEN = process.env.MCP_HUB_REGISTRY_TOKEN
export const MCP_HUB_REGISTRY_CACHE_TTL_MS = positiveInteger(process.env.MCP_HUB_REGISTRY_CACHE_TTL_MS, 5000)
export const MCP_GATEWAY_ACCESS_SCOPE = requiredString(
  "MCP_GATEWAY_ACCESS_SCOPE",
  "api:role.mcp-accessor api:role.docs-getter",
)
export const ATHENZ_ZTS_URL = withoutTrailingSlash(
  process.env.ATHENZ_ZTS_URL ?? "https://athenz-zts-server.athenz:4443/zts/v1",
)
export const ATHENZ_ZTS_AUDIENCE = process.env.ATHENZ_ZTS_AUDIENCE ?? ATHENZ_ZTS_URL
export const ATHENZ_CERT_PATH = process.env.ATHENZ_CERT_PATH ?? path.join("/var/run/athenz", "service.cert.pem")
export const ATHENZ_KEY_PATH = process.env.ATHENZ_KEY_PATH ?? path.join("/var/run/athenz", "service.key.pem")
export const ATHENZ_CA_PATH = process.env.ATHENZ_CA_PATH ?? path.join("/var/run/athenz", "ca.crt")
export const ATHENZ_TLS_SERVER_NAME = process.env.ATHENZ_TLS_SERVER_NAME
export const ATHENZ_REJECT_UNAUTHORIZED = booleanValue(process.env.ATHENZ_REJECT_UNAUTHORIZED, true)
export const ATHENZ_ACCESS_TOKEN_EXPIRES_IN = positiveInteger(process.env.ATHENZ_ACCESS_TOKEN_EXPIRES_IN, 3600)
export const ATHENZ_REQUEST_TIMEOUT_MS = positiveInteger(process.env.ATHENZ_REQUEST_TIMEOUT_MS, 10_000)
export const AUTHORIZATION_TRANSACTION_TTL_SECONDS = positiveInteger(
  process.env.AUTHORIZATION_TRANSACTION_TTL_SECONDS,
  300,
)
export const AUTHORIZATION_CODE_TTL_SECONDS = positiveInteger(process.env.AUTHORIZATION_CODE_TTL_SECONDS, 60)

export const KEYCLOAK_TOKEN_ENDPOINT = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`
export const KEYCLOAK_AUTHORIZATION_ENDPOINT = `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/auth`
export const KEYCLOAK_JWKS_ENDPOINT = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/certs`
