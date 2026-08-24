import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/features/auth/lib/auth"
import { listMcpServersFromKubernetes } from "@/features/catalog/api/kubernetesCatalog"
import { isMcpHubServiceRequest } from "@/features/catalog/lib/mcpHubServiceAuth"
import type { CatalogResponse } from "@/features/catalog/types/catalog"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const serviceRequest = isMcpHubServiceRequest(request)
  const session = serviceRequest ? null : await auth()
  if (!serviceRequest && !session?.user) {
    return NextResponse.json({ servers: [], error: "Authentication required" }, { status: 401 })
  }

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
