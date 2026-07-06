import { NextResponse } from "next/server"
import { listMcpServersFromKubernetes } from "@/features/catalog/api/kubernetesCatalog"
import type { CatalogResponse } from "@/features/catalog/types/catalog"

export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const servers = await listMcpServersFromKubernetes()
    return NextResponse.json<CatalogResponse>(
      { servers },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read MCP server deployments"
    return NextResponse.json<CatalogResponse>(
      { servers: [], error: message },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    )
  }
}
