import { headers } from "next/headers"
import type { McpTemplateListResponse } from "../types"

export async function fetchMcpTemplates(project: string): Promise<McpTemplateListResponse> {
  const requestHeaders = await headers()
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")
  if (!host) return { templates: [], error: "Missing host header for MCP template request" }

  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http"
  const cookie = requestHeaders.get("cookie")
  const response = await fetch(
    `${protocol}://${host}/api/mcp-templates?project=${encodeURIComponent(project)}`,
    {
      cache: "no-store",
      headers: cookie ? { cookie } : undefined,
    },
  )
  if (!response.ok) return { templates: [], error: `MCP template API returned ${response.status}` }
  return response.json() as Promise<McpTemplateListResponse>
}
