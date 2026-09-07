import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/features/auth/lib/auth"
import {
  deleteMcpResources,
  getMcpServerConfiguration,
  McpResourceNotFoundError,
  updateMcpResources,
} from "@/features/registration/api/mcpResources"
import {
  createZmsRequest,
  deleteMcpManagedAccess,
  ensureMcpManagedAccess,
  ensureMcpSourceExchangeAccess,
} from "@/features/registration/api/mcpManagedAccess"
import { ensureMcpRuntimeProxyTrust } from "@/features/registration/api/mcpRuntimeProxy"
import { validateMcpUpdate } from "@/features/registration/lib/registrationInput"
import { signedInUserPermissionAudiences } from "@/features/permissions/lib/toolPermissionDraft"

export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = { "Cache-Control": "no-store" }
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/

export async function GET(
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
  const reference = await serverReference(request, params)
  if (!reference) {
    return NextResponse.json(
      { error: "Invalid MCP server reference" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    const server = await getMcpServerConfiguration(reference.project, reference.mcpKeyName)
    return NextResponse.json({ server }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    if (error instanceof McpResourceNotFoundError) {
      return NextResponse.json(
        { error: error.message },
        { status: 404, headers: NO_STORE_HEADERS },
      )
    }
    return NextResponse.json(
      { error: "Unable to load MCP server from Kubernetes" },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}

export async function DELETE(
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
  const reference = await serverReference(request, params)
  if (!reference) {
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
      { error: "Invalid MCP server deletion request" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }
  const confirmation = deleteConfirmation(payload)
  if (confirmation === null) {
    return NextResponse.json(
      { error: "MCP server name confirmation is required" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    const server = await getMcpServerConfiguration(reference.project, reference.mcpKeyName)
    if (confirmation !== server.serverName) {
      return NextResponse.json(
        { error: "MCP server name confirmation does not match" },
        { status: 400, headers: NO_STORE_HEADERS },
      )
    }
    if (server.accessManagement === "hub") {
      await deleteMcpManagedAccess(reference.project, reference.mcpKeyName)
    }
    await deleteMcpResources(reference.project, reference.mcpKeyName)
    return NextResponse.json({ deleted: reference }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    if (error instanceof McpResourceNotFoundError) {
      return NextResponse.json(
        { error: error.message },
        { status: 404, headers: NO_STORE_HEADERS },
      )
    }
    const detail = error instanceof Error ? error.message.trim().replace(/\s+/g, " ").slice(0, 300) : ""
    console.error("Unable to delete MCP server", { ...reference, detail })
    return NextResponse.json(
      { error: detail ? `Unable to delete MCP server: ${detail}` : "Unable to delete MCP server" },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ mcpKeyName: string }> },
) {
  const session = await auth()
  if (!session?.user?.username) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401, headers: NO_STORE_HEADERS },
    )
  }
  const username = session.user.username

  const reference = await serverReference(request, params)
  if (!reference) {
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
      { error: "Invalid MCP server update request" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    const existing = await getMcpServerConfiguration(reference.project, reference.mcpKeyName)
    const validation = validateMcpUpdate(payload, existing)
    if (!validation.ok) {
      return NextResponse.json(
        { error: validation.error },
        { status: 400, headers: NO_STORE_HEADERS },
      )
    }

    if (validation.input.accessManagement === "hub") {
      const requestZms = await createZmsRequest()
      await ensureMcpManagedAccess(
        validation.input.project,
        validation.input.mcpKeyName,
        username,
        validation.input.serviceAccount,
        requestZms,
      )
      const sourceExchangeAudiences = signedInUserPermissionAudiences(validation.input.toolPermissions)
      if (sourceExchangeAudiences.length > 0) {
        await ensureMcpSourceExchangeAccess(
          validation.input.project,
          validation.input.mcpKeyName,
          validation.input.serviceAccount,
          sourceExchangeAudiences,
          requestZms,
        )
      }
      await ensureMcpRuntimeProxyTrust(validation.input.project)
    }
    await updateMcpResources(validation.input)
    return NextResponse.json(
      { server: { name: reference.mcpKeyName, project: reference.project } },
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    if (error instanceof McpResourceNotFoundError) {
      return NextResponse.json(
        { error: error.message },
        { status: 404, headers: NO_STORE_HEADERS },
      )
    }
    const detail = error instanceof Error ? error.message.trim().replace(/\s+/g, " ").slice(0, 300) : ""
    console.error("Unable to update MCP server", {
      project: reference.project,
      mcpKeyName: reference.mcpKeyName,
      detail,
    })
    return NextResponse.json(
      { error: detail ? `Unable to update MCP server: ${detail}` : "Unable to update MCP server" },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}

async function serverReference(
  request: NextRequest,
  params: Promise<{ mcpKeyName: string }>,
) {
  const { mcpKeyName } = await params
  const project = request.nextUrl.searchParams.get("project") ?? ""
  return DNS_LABEL_PATTERN.test(project) && DNS_LABEL_PATTERN.test(mcpKeyName)
    ? { project, mcpKeyName }
    : null
}

function deleteConfirmation(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null
  const confirmation = (payload as Record<string, unknown>).confirmation
  return typeof confirmation === "string" ? confirmation : null
}
