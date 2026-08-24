import { timingSafeEqual } from "node:crypto"
import type { NextRequest } from "next/server"

export function isMcpHubServiceRequest(request: NextRequest): boolean {
  const expected = process.env.MCP_HUB_REGISTRY_TOKEN
  const authorization = request.headers.get("authorization")
  if (!expected || !authorization?.startsWith("Bearer ")) return false

  const suppliedBuffer = Buffer.from(authorization.slice("Bearer ".length))
  const expectedBuffer = Buffer.from(expected)
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer)
}
