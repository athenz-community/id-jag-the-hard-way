import { readFile } from "node:fs/promises"
import https from "node:https"
import path from "node:path"

const DEFAULT_ZTS_URL = "https://localhost:8443/zts/v1"
const TOKEN_EXPIRY_SKEW_MS = 60_000

type AthenzTokenResponse = {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

type CachedToken = {
  scope: string
  token: string
  expiresAtMs: number
}

let cachedToken: CachedToken | null = null

export async function getMcpAccessToken(): Promise<string | null> {
  const scope = (process.env.MCP_HUB_MCP_ACCESS_SCOPE ?? "").trim()
  if (!scope) return null

  const now = Date.now()
  if (cachedToken?.scope === scope && cachedToken.expiresAtMs > now + TOKEN_EXPIRY_SKEW_MS) {
    return cachedToken.token
  }

  const tokenResponse = await requestAthenzAccessToken(scope)
  if (!tokenResponse.access_token) {
    const message = tokenResponse.error_description ?? tokenResponse.error ?? "ZTS did not return an access token"
    throw new Error(`Failed to issue MCP Hub access token for ${scope}: ${message}`)
  }

  const expiresInSeconds = tokenResponse.expires_in ?? 3600
  cachedToken = {
    scope,
    token: tokenResponse.access_token,
    expiresAtMs: now + expiresInSeconds * 1000,
  }

  return cachedToken.token
}

async function requestAthenzAccessToken(scope: string): Promise<AthenzTokenResponse> {
  const certPath = certFilePath("MCP_HUB_ATHENZ_CERT_PATH", "mcp-hub-ui.crt")
  const keyPath = certFilePath("MCP_HUB_ATHENZ_KEY_PATH", "mcp-hub-ui.key")
  const caPath = certFilePath("MCP_HUB_ATHENZ_CA_PATH", "ca.crt")
  const ztsUrl = (process.env.MCP_HUB_ZTS_URL ?? DEFAULT_ZTS_URL).replace(/\/+$/, "")
  const endpoint = `${ztsUrl}/oauth2/token`

  const [cert, key, ca] = await Promise.all([
    readFile(/* turbopackIgnore: true */ certPath),
    readFile(/* turbopackIgnore: true */ keyPath),
    readFile(/* turbopackIgnore: true */ caPath),
  ])
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope,
    expires_in: process.env.MCP_HUB_ACCESS_TOKEN_EXPIRES_IN ?? "3600",
  }).toString()

  return postForm(endpoint, body, cert, key, ca)
}

function certFilePath(envName: string, fileName: string): string {
  const configuredPath = process.env[envName]
  if (configuredPath) return configuredPath

  const configuredDir = process.env.MCP_HUB_CERT_DIR
  if (configuredDir) return path.join(/* turbopackIgnore: true */ configuredDir, fileName)

  return path.join(process.cwd(), "certs", fileName)
}

function postForm(endpoint: string, body: string, cert: Buffer, key: Buffer, ca: Buffer): Promise<AthenzTokenResponse> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      endpoint,
      {
        method: "POST",
        cert,
        key,
        ca,
        rejectUnauthorized: process.env.MCP_HUB_ZTS_REJECT_UNAUTHORIZED === "true",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(body),
          Accept: "application/json",
        },
        timeout: 10_000,
      },
      (response) => {
        let responseBody = ""
        response.setEncoding("utf8")
        response.on("data", (chunk) => {
          responseBody += chunk
        })
        response.on("end", () => {
          if (!response.statusCode || response.statusCode >= 400) {
            reject(new Error(`ZTS returned ${response.statusCode ?? "unknown"}: ${responseBody}`))
            return
          }

          try {
            const payload = JSON.parse(responseBody) as AthenzTokenResponse
            resolve(payload)
          } catch (error) {
            reject(error)
          }
        })
      },
    )

    request.on("timeout", () => {
      request.destroy(new Error("Timed out while requesting an MCP Hub access token from ZTS"))
    })
    request.on("error", reject)
    request.write(body)
    request.end()
  })
}
