import { headers } from "next/headers"
import type { CatalogResponse } from "@/features/catalog/types/catalog"

export async function fetchCatalog(): Promise<CatalogResponse> {
  const requestHeaders = await headers()
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host")

  if (!host) {
    return { servers: [], error: "Missing host header for MCP Hub API request" }
  }

  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http"
  const response = await fetch(`${protocol}://${host}/api/mcp-servers`, {
    cache: "no-store",
  })

  if (!response.ok) {
    return { servers: [], error: `MCP Hub API returned ${response.status}` }
  }

  return response.json() as Promise<CatalogResponse>
}
