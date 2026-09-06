import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/features/auth/lib/auth"
import { parseToolPermissionSettings } from "@/features/permissions/lib/permissionPreset"
import {
  McpResourceNotFoundError,
  updateMcpToolPermissions,
} from "@/features/registration/api/mcpResources"

export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = { "Cache-Control": "no-store" }
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ mcpKeyName: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401, headers: NO_STORE_HEADERS },
    )
  }

  const { mcpKeyName } = await params
  const project = request.nextUrl.searchParams.get("project") ?? ""
  if (!DNS_LABEL_PATTERN.test(project) || !DNS_LABEL_PATTERN.test(mcpKeyName)) {
    return NextResponse.json(
      { error: "Invalid MCP server reference" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Invalid tool permission request" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  let input: ReturnType<typeof validateToolPermissionUpdate>
  try {
    input = validateToolPermissionUpdate(payload)
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid tool permission request" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    const settings = await updateMcpToolPermissions(
      project,
      mcpKeyName,
      input.toolName,
      input.requirements,
    )
    return NextResponse.json({ settings }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update tool permissions"
    console.error("Unable to update MCP tool permissions", { project, mcpKeyName, toolName: input.toolName, message })
    return NextResponse.json(
      { error: error instanceof McpResourceNotFoundError ? message : "Unable to update tool permissions" },
      { status: error instanceof McpResourceNotFoundError ? 404 : 500, headers: NO_STORE_HEADERS },
    )
  }
}

function validateToolPermissionUpdate(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Tool permission request must be an object")
  }
  const input = value as Record<string, unknown>
  const toolName = typeof input.toolName === "string" ? input.toolName.trim() : ""
  if (!toolName || toolName.length > 256 || /[\u0000-\u001f\u007f]/.test(toolName)) {
    throw new Error("Tool name is invalid")
  }
  const settings = parseToolPermissionSettings({
    version: 1,
    tools: { [toolName]: { requirements: input.requirements } },
  })
  return { toolName, requirements: settings.tools[toolName].requirements }
}
