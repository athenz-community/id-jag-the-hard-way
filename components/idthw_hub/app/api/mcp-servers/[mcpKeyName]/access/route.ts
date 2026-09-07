import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/features/auth/lib/auth"
import {
  mergeToolPermissionSettings,
  toolPermissionSettingsForServer,
} from "@/features/permissions/lib/permissionPreset"
import { readPermissionPresetConfigMap } from "@/features/permissions/lib/fetchPermissionReadiness"
import { signedInUserPermissionAudiences } from "@/features/permissions/lib/toolPermissionDraft"
import {
  createZmsRequest,
  ensureMcpManagedAccess,
  ensureMcpManagedAccessorMember,
  ensureMcpSourceExchangeAccess,
} from "@/features/registration/api/mcpManagedAccess"
import {
  getMcpServerConfiguration,
  McpResourceNotFoundError,
  reconcileMcpManagedAccessConfiguration,
} from "@/features/registration/api/mcpResources"
import { managedMcpAccessScope } from "@/features/registration/lib/kubernetesManifest"

export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = { "Cache-Control": "no-store" }
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/

export async function POST(
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

  const { mcpKeyName } = await params
  const project = request.nextUrl.searchParams.get("project") ?? ""
  if (!DNS_LABEL_PATTERN.test(project) || !DNS_LABEL_PATTERN.test(mcpKeyName)) {
    return NextResponse.json(
      { error: "Invalid MCP server reference" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    const configuration = await getMcpServerConfiguration(project, mcpKeyName)
    if (configuration.accessManagement !== "hub" || !configuration.serviceAccount) {
      return NextResponse.json(
        { error: "This MCP server does not use Hub-managed access" },
        { status: 400, headers: NO_STORE_HEADERS },
      )
    }

    const presetDocument = await readPermissionPresetConfigMap()
    const presetSettings = toolPermissionSettingsForServer(presetDocument, mcpKeyName)
    const toolPermissions = mergeToolPermissionSettings(
      presetSettings,
      configuration.toolPermissions,
    )
    const sourceExchangeAudiences = signedInUserPermissionAudiences(toolPermissions)
    const requestZms = await createZmsRequest()
    const managedReport = await ensureMcpManagedAccess(
      project,
      mcpKeyName,
      configuration.serviceAccount,
      requestZms,
    )
    const accessorMemberAdded = await ensureMcpManagedAccessorMember(
      project,
      mcpKeyName,
      session.user.username,
      requestZms,
    )
    const sourceReport = sourceExchangeAudiences.length > 0
      ? await ensureMcpSourceExchangeAccess(
        project,
        mcpKeyName,
        configuration.serviceAccount,
        sourceExchangeAudiences,
        requestZms,
      )
      : undefined
    const configurationUpdated = await reconcileMcpManagedAccessConfiguration(project, mcpKeyName)
    const changed = configurationUpdated
      || Object.values(managedReport).some(Boolean)
      || accessorMemberAdded
      || Boolean(sourceReport && Object.values(sourceReport).some(Boolean))

    return NextResponse.json({
      accessRole: managedMcpAccessScope(project, mcpKeyName),
      approved: true,
      changed,
      checksCompleted: 10,
    }, { headers: NO_STORE_HEADERS })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to request MCP access"
    console.error("Unable to request Hub-managed MCP access", {
      project,
      mcpKeyName,
      message: message.trim().replace(/\s+/g, " ").slice(0, 300),
    })
    return NextResponse.json(
      { error: error instanceof McpResourceNotFoundError ? message : "Unable to request MCP access" },
      {
        status: error instanceof McpResourceNotFoundError ? 404 : 500,
        headers: NO_STORE_HEADERS,
      },
    )
  }
}
