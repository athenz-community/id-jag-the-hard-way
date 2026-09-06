import http, { type IncomingMessage, type ServerResponse } from "node:http"
import { readDelegatedAccessToken } from "./tokenFile.ts"

const MAX_REQUEST_BYTES = 64 * 1024
const UPSTREAM_TIMEOUT_MS = 10_000

type JsonRpcId = string | number | null
type JsonRpcMessage = {
  id?: JsonRpcId
  jsonrpc?: unknown
  method?: unknown
  params?: unknown
}

type Tool = {
  description: string
  inputSchema: Record<string, unknown>
  method: "DELETE" | "GET" | "POST"
  name: string
  path(args: Record<string, unknown>): string
  requestBody?(args: Record<string, unknown>): unknown
  title: string
}

const tools: Tool[] = [
  {
    name: "get_k8s_docs",
    title: "Get Kubernetes Documents",
    description: "Get the list of documents from the protected Kubernetes Docs API.",
    method: "GET",
    path: () => "/api/docs",
    inputSchema: { type: "object", additionalProperties: false },
  },
  {
    name: "post_k8s_doc",
    title: "Post Kubernetes Document",
    description: "Create a document in the protected Kubernetes Docs API.",
    method: "POST",
    path: () => "/api/docs",
    requestBody: (args) => ({ name: args.name, content: args.content }),
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string", description: "Document title" },
        content: { type: "string", description: "Document content" },
      },
      required: ["name", "content"],
    },
  },
  {
    name: "delete_k8s_doc",
    title: "Delete Kubernetes Document",
    description: "Delete a document from the protected Kubernetes Docs API by numeric ID.",
    method: "DELETE",
    path: (args) => `/api/docs/${positiveDocumentId(args.doc_id)}`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        doc_id: { type: "integer", minimum: 1, description: "Numeric document ID" },
      },
      required: ["doc_id"],
    },
  },
]

export function createDelegatedK8sDocsMcpServer({
  tokenDirectory = "/var/run/idthw-access-tokens",
  upstreamBaseUrl,
}: {
  tokenDirectory?: string
  upstreamBaseUrl: URL
}) {
  if (upstreamBaseUrl.protocol !== "http:" && upstreamBaseUrl.protocol !== "https:") {
    throw new Error("UPSTREAM_BASE_URL must use HTTP or HTTPS")
  }
  if (upstreamBaseUrl.username || upstreamBaseUrl.password) {
    throw new Error("UPSTREAM_BASE_URL must not contain credentials")
  }

  return http.createServer(async (request, response) => {
    let responseId: JsonRpcId = null
    try {
      const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`)
      if (request.method === "GET" && requestUrl.pathname === "/healthz") {
        sendJson(response, 200, { ok: true })
        return
      }
      if (requestUrl.pathname !== "/mcp") {
        sendJson(response, 404, { error: "not_found" })
        return
      }
      if (request.method !== "POST") {
        response.setHeader("allow", "POST")
        sendJson(response, 405, { error: "method_not_allowed" })
        return
      }

      const message = await readJsonRpcMessage(request)
      if (!Object.hasOwn(message, "id")) {
        response.statusCode = 202
        response.end()
        return
      }
      const id = message.id ?? null
      responseId = id
      if (message.jsonrpc !== "2.0" || typeof message.method !== "string") {
        sendJson(response, 400, rpcError(id, -32600, "Invalid JSON-RPC request"))
        return
      }

      if (message.method === "initialize") {
        const params = recordValue(message.params)
        sendJson(response, 200, rpcResult(id, {
          protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : "2025-03-26",
          capabilities: { tools: { listChanged: false } },
          serverInfo: {
            name: "idthw-demo-api-mcp",
            title: "IDTHW Demo API MCP",
            version: "0.1.0",
          },
        }))
        return
      }
      if (message.method === "ping") {
        sendJson(response, 200, rpcResult(id, {}))
        return
      }
      if (message.method === "tools/list") {
        sendJson(response, 200, rpcResult(id, {
          tools: tools.map(({ name, title, description, inputSchema }) => ({
            name,
            title,
            description,
            inputSchema,
          })),
        }))
        return
      }
      if (message.method !== "tools/call") {
        sendJson(response, 200, rpcError(id, -32601, `Method not found: ${message.method}`))
        return
      }

      const params = recordValue(message.params)
      if (typeof params.name !== "string") {
        sendJson(response, 200, rpcError(id, -32602, "tools/call params.name must be a string"))
        return
      }
      const tool = tools.find(({ name }) => name === params.name)
      if (!tool) {
        sendJson(response, 200, rpcError(id, -32602, `Unknown tool: ${params.name}`))
        return
      }
      const args = recordValue(params.arguments)
      validateArguments(tool, args)
      const upstreamUrl = new URL(tool.path(args), upstreamBaseUrl)
      const bodyValue = tool.requestBody?.(args)

      // Read immediately before the downstream request so each call uses the
      // request-scoped file published by MCP Runtime Proxy.
      const accessToken = await readDelegatedAccessToken(params._meta, tool.name, tokenDirectory)
      const headers: Record<string, string> = {
        Accept: "application/json, text/plain, */*",
        Authorization: `Bearer ${accessToken}`,
      }
      const body = bodyValue === undefined ? undefined : JSON.stringify(bodyValue)
      if (body !== undefined) headers["Content-Type"] = "application/json"
      const upstreamResponse = await fetch(upstreamUrl, {
        method: tool.method,
        headers,
        body,
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      })
      const responseText = await upstreamResponse.text()
      const upstreamResult = {
        status: upstreamResponse.status,
        ok: upstreamResponse.ok,
        data: parseJsonOrText(responseText),
      }
      sendJson(response, 200, rpcResult(id, {
        content: [{ type: "text", text: JSON.stringify(upstreamResult, null, 2) }],
        structuredContent: upstreamResult,
        isError: !upstreamResponse.ok,
      }))
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool execution failed"
      sendJson(response, 200, rpcError(responseId, -32603, message))
    }
  })
}

function validateArguments(tool: Tool, args: Record<string, unknown>) {
  if (tool.name === "post_k8s_doc") {
    if (typeof args.name !== "string" || !args.name.trim()) throw new Error("name must be a non-empty string")
    if (typeof args.content !== "string" || !args.content.trim()) throw new Error("content must be a non-empty string")
  }
  if (tool.name === "delete_k8s_doc") positiveDocumentId(args.doc_id)
}

function positiveDocumentId(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1) throw new Error("doc_id must be a positive integer")
  return encodeURIComponent(String(value))
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

async function readJsonRpcMessage(request: IncomingMessage): Promise<JsonRpcMessage> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of request) {
    const value = Buffer.from(chunk)
    bytes += value.byteLength
    if (bytes > MAX_REQUEST_BYTES) throw new Error("MCP request body exceeds the size limit")
    chunks.push(value)
  }
  try {
    const message = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown
    if (message && typeof message === "object" && !Array.isArray(message)) return message as JsonRpcMessage
  } catch {
    // Return the stable invalid-request error below.
  }
  throw new Error("Invalid JSON-RPC request")
}

function parseJsonOrText(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function rpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result }
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id, error: { code, message } }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown) {
  if (response.headersSent) return
  response.statusCode = statusCode
  response.setHeader("content-type", "application/json; charset=utf-8")
  response.setHeader("cache-control", "no-store")
  response.end(JSON.stringify(body))
}
