import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/features/auth/lib/auth"
import { getMcpAccessTokenCacheStatus } from "@/features/catalog/lib/athenzAccessToken"
import { getMcpGatewayCacheStatus } from "@/features/catalog/lib/mcpGatewayCacheStatus"
import { isMcpHubServiceRequest } from "@/features/catalog/lib/mcpHubServiceAuth"

export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
}

export async function GET(request: NextRequest) {
  const serviceRequest = isMcpHubServiceRequest(request)
  const session = serviceRequest ? null : await auth()
  if (!serviceRequest && !session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401, headers: NO_STORE_HEADERS },
    )
  }

  const gatewayOAuthSessions = await getMcpGatewayCacheStatus()

  return NextResponse.json(
    {
      athenzAccessTokens: getMcpAccessTokenCacheStatus(),
      gatewayOAuthSessions,
    },
    { headers: NO_STORE_HEADERS },
  )
}
