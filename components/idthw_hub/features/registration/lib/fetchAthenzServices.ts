import "server-only"

import { readFile } from "node:fs/promises"
import https from "node:https"
import path from "node:path"
import { parseAthenzServiceList } from "./athenzServices"

const DEFAULT_ZMS_URL = "https://localhost:4443/zms/v1"
const MAX_RESPONSE_BYTES = 256 * 1024

type ZmsCredentials = {
  ca: Buffer
  cert: Buffer
  key: Buffer
  rejectUnauthorized: boolean
  servername?: string
}

export async function fetchAthenzServices(domain: string) {
  const zmsUrl = (process.env.MCP_HUB_ZMS_URL ?? DEFAULT_ZMS_URL).replace(/\/+$/, "")
  const endpoint = new URL(`${zmsUrl}/domain/${encodeURIComponent(domain)}/service`)
  const credentials = await loadZmsCredentials()
  const response = await requestZms(endpoint, credentials)

  if (response.status !== 200) {
    throw new Error(`ZMS returned HTTP ${response.status}`)
  }

  return parseAthenzServiceList(JSON.parse(response.body) as unknown, domain)
}

async function loadZmsCredentials(): Promise<ZmsCredentials> {
  const [cert, key, ca] = await Promise.all([
    readFile(/* turbopackIgnore: true */ certFilePath("MCP_HUB_ATHENZ_CERT_PATH", "mcp-hub-ui.crt")),
    readFile(/* turbopackIgnore: true */ certFilePath("MCP_HUB_ATHENZ_KEY_PATH", "mcp-hub-ui.key")),
    readFile(/* turbopackIgnore: true */ certFilePath("MCP_HUB_ATHENZ_CA_PATH", "ca.crt")),
  ])

  return {
    cert,
    key,
    ca,
    rejectUnauthorized: process.env.MCP_HUB_ZMS_REJECT_UNAUTHORIZED === "true",
    servername: process.env.MCP_HUB_ZMS_TLS_SERVER_NAME,
  }
}

function requestZms(endpoint: URL, credentials: ZmsCredentials): Promise<{ body: string; status: number }> {
  if (endpoint.protocol !== "https:") {
    return Promise.reject(new Error(`Unsupported ZMS protocol ${endpoint.protocol}`))
  }

  const headers: Record<string, string> = { Accept: "application/json" }
  if (credentials.servername) {
    headers.Host = endpoint.port ? `${credentials.servername}:${endpoint.port}` : credentials.servername
  }

  return new Promise((resolve, reject) => {
    const request = https.request(endpoint, {
      method: "GET",
      ...credentials,
      headers,
      timeout: 3000,
    }, (response) => {
      let body = ""
      let responseBytes = 0
      response.setEncoding("utf8")
      response.on("data", (chunk: string) => {
        responseBytes += Buffer.byteLength(chunk)
        if (responseBytes > MAX_RESPONSE_BYTES) {
          response.destroy(new Error("ZMS service list response exceeded the size limit"))
          return
        }
        body += chunk
      })
      response.on("end", () => resolve({ body, status: response.statusCode ?? 0 }))
      response.on("error", reject)
    })

    request.on("timeout", () => request.destroy(new Error("Timed out while listing Athenz services")))
    request.on("error", reject)
    request.end()
  })
}

function certFilePath(envName: string, fileName: string) {
  const configuredPath = process.env[envName]
  if (configuredPath) return configuredPath
  const configuredDir = process.env.MCP_HUB_CERT_DIR
  if (configuredDir) return path.join(/* turbopackIgnore: true */ configuredDir, fileName)
  return path.join(process.cwd(), "certs", fileName)
}
