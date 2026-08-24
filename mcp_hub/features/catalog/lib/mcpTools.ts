import type { McpServer } from "@/features/catalog/types/catalog"
import type { McpTool, McpToolsResult } from "@/features/catalog/types/tools"
import { getMcpAccessToken } from "./athenzAccessToken"

const DEFAULT_LOCAL_MCP_URL = process.env.MCP_HUB_LOCAL_MCP_URL ?? "http://127.0.0.1:24443/mcp"

type JsonRpcToolsListResponse = {
  jsonrpc?: string
  id?: string | number
  result?: {
    tools?: McpTool[]
  }
  error?: {
    message?: string
  }
}

export async function listLiveMcpTools(server: McpServer): Promise<McpToolsResult> {
  const endpoint = resolveMcpToolsEndpoint(server)

  try {
    const accessToken = await getMcpAccessToken()
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    }
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`
    }

    const response = await fetch(endpoint, {
      method: "POST",
      cache: "no-store",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {},
      }),
    })

    if (!response.ok) {
      return { endpoint, tools: [], error: `MCP server returned ${response.status}` }
    }

    const payload = await parseMcpJsonRpcResponse(response)
    if (payload.error) {
      return { endpoint, tools: [], error: payload.error.message ?? "MCP tools/list returned an error" }
    }

    return { endpoint, tools: payload.result?.tools ?? [] }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to call MCP tools/list"
    return { endpoint, tools: [], error: message }
  }
}

export function resolveMcpDisplayUrl(server?: McpServer) {
  if (server?.gatewayUrl) return server.gatewayUrl
  return normalizeMcpEndpoint(server?.publicUrl ?? process.env.MCP_HUB_PUBLIC_MCP_URL ?? DEFAULT_LOCAL_MCP_URL)
}

function resolveMcpToolsEndpoint(server: McpServer) {
  const template = process.env.MCP_HUB_MCP_URL_TEMPLATE
  if (template) {
    return template
      .replaceAll("{server}", encodeURIComponent(server.name))
      .replaceAll("{name}", encodeURIComponent(server.name))
      .replaceAll("{namespace}", encodeURIComponent(server.namespace))
  }

  if (server.proxyUrl) {
    return normalizeMcpEndpoint(server.proxyUrl)
  }

  if (server.publicUrl) {
    return normalizeMcpEndpoint(server.publicUrl)
  }

  if (process.env.MCP_HUB_PUBLIC_MCP_URL) {
    return normalizeMcpEndpoint(process.env.MCP_HUB_PUBLIC_MCP_URL)
  }

  if (process.env.KUBERNETES_SERVICE_HOST) {
    return process.env.MCP_HUB_IN_CLUSTER_MCP_URL ?? `http://${server.name}.${server.namespace}:8081/mcp`
  }

  return DEFAULT_LOCAL_MCP_URL
}

function normalizeMcpEndpoint(value: string) {
  const raw = value.trim()
  const withProtocol = /^https?:\/\//.test(raw) ? raw : `http://${raw}`

  try {
    const url = new URL(withProtocol)
    if (url.pathname === "" || url.pathname === "/") {
      url.pathname = "/mcp"
    }
    return url.toString()
  } catch {
    return raw
  }
}

async function parseMcpJsonRpcResponse(response: Response): Promise<JsonRpcToolsListResponse> {
  const body = await response.text()
  const contentType = response.headers.get("content-type") ?? ""

  if (contentType.includes("text/event-stream") || body.trimStart().startsWith("event:")) {
    return parseSseJsonRpcResponse(body)
  }

  return JSON.parse(body) as JsonRpcToolsListResponse
}

function parseSseJsonRpcResponse(body: string): JsonRpcToolsListResponse {
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trimStart())
      .join("\n")

    if (!data) {
      continue
    }

    const payload = JSON.parse(data) as JsonRpcToolsListResponse
    if (payload.result || payload.error) {
      return payload
    }
  }

  throw new Error("MCP server returned an SSE response without a JSON-RPC message")
}
