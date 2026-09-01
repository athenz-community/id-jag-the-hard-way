import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/features/auth/lib/auth"
import { listMcpServersFromKubernetes } from "@/features/catalog/api/kubernetesCatalog"
import { isMcpHubServiceRequest } from "@/features/catalog/lib/mcpHubServiceAuth"
import type { CatalogResponse } from "@/features/catalog/types/catalog"
import { readPermissionPresetConfigMap } from "@/features/permissions/lib/fetchPermissionReadiness"
import { parseToolAccessScopesForServer } from "@/features/permissions/lib/permissionPreset"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const serviceRequest = isMcpHubServiceRequest(request)
  const session = serviceRequest ? null : await auth()
  if (!serviceRequest && !session?.user) {
    return NextResponse.json({ servers: [], error: "Authentication required" }, { status: 401 })
  }

  try {
    const [servers, permissionPreset] = await Promise.all([
      listMcpServersFromKubernetes(),
      readPermissionPresetConfigMap(),
    ])
    const registryServers = servers.map((server) => ({
      ...server,
      toolScopes: parseToolAccessScopesForServer(permissionPreset, server.routeId),
    }))
    return NextResponse.json<CatalogResponse>(
      { servers: registryServers },
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
