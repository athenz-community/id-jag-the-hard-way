import type { McpServer } from "@/features/catalog/types/catalog"
import type { McpTool, McpToolsResult } from "@/features/catalog/types/tools"

const DEFAULT_LOCAL_MCP_URL = process.env.MCP_HUB_LOCAL_MCP_URL ?? "http://127.0.0.1:24443/mcp"
const MCP_PROTOCOL_VERSION = "2025-06-18"

type JsonRpcToolsListResponse = {
  jsonrpc?: string
  id?: string | number
  result?: {
    protocolVersion?: string
    tools?: McpTool[]
  }
  error?: {
    message?: string
  }
}

export async function listLiveMcpTools(server: McpServer): Promise<McpToolsResult> {
  const endpoint = resolveMcpToolsEndpoint(server)
  let sessionId = ""

  try {
    const initializeResponse = await sendMcpRequest(endpoint, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "idthw-hub", version: "1.0.0" },
      },
    })
    if (!initializeResponse.ok) {
      return { endpoint, tools: [], error: `MCP initialize returned ${initializeResponse.status}` }
    }

    const initializePayload = await parseMcpJsonRpcResponse(initializeResponse)
    if (initializePayload.error) {
      return { endpoint, tools: [], error: initializePayload.error.message ?? "MCP initialize returned an error" }
    }

    sessionId = initializeResponse.headers.get("mcp-session-id")?.trim() ?? ""
    const protocolVersion = initializePayload.result?.protocolVersion ?? MCP_PROTOCOL_VERSION
    const initializedResponse = await sendMcpRequest(
      endpoint,
      {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      },
      sessionId,
      protocolVersion,
    )
    if (!initializedResponse.ok) {
      return { endpoint, tools: [], error: `MCP initialized notification returned ${initializedResponse.status}` }
    }

    const response = await sendMcpRequest(
      endpoint,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      sessionId,
      protocolVersion,
    )

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
  } finally {
    if (sessionId) await closeMcpSession(endpoint, sessionId)
  }
}

async function sendMcpRequest(
  endpoint: string,
  payload: Record<string, unknown>,
  sessionId = "",
  protocolVersion = MCP_PROTOCOL_VERSION,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": protocolVersion,
  }
  if (sessionId) headers["Mcp-Session-Id"] = sessionId

  return fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    headers,
    body: JSON.stringify(payload),
  })
}

async function closeMcpSession(endpoint: string, sessionId: string) {
  try {
    await fetch(endpoint, {
      method: "DELETE",
      cache: "no-store",
      headers: {
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        "Mcp-Session-Id": sessionId,
      },
    })
  } catch {
    // Session cleanup is best-effort and must not hide a successful tool listing.
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
