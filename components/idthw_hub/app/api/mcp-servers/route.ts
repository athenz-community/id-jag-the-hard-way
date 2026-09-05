import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/features/auth/lib/auth"
import { listMcpServersFromKubernetes } from "@/features/catalog/api/kubernetesCatalog"
import { isMcpHubServiceRequest } from "@/features/catalog/lib/mcpHubServiceAuth"
import type { CatalogResponse } from "@/features/catalog/types/catalog"
import { readPermissionPresetConfigMap } from "@/features/permissions/lib/fetchPermissionReadiness"
import { parseToolAccessScopesForServer } from "@/features/permissions/lib/permissionPreset"
import {
  createMcpResources,
  McpResourceConflictError,
} from "@/features/registration/api/createMcpResources"
import { validateMcpRegistration } from "@/features/registration/lib/registrationInput"
import {
  getMcpTemplate,
  McpTemplateNotFoundError,
} from "@/features/mcp-templates/api/kubernetesTemplates"
import {
  getTemplateRegistrationReference,
  resolveMcpTemplateRegistration,
} from "@/features/mcp-templates/lib/templateRegistration"

export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
}

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

export async function POST(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401, headers: NO_STORE_HEADERS },
    )
  }

  let payload: unknown
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { error: "Invalid registration request" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  const templateReference = getTemplateRegistrationReference(payload)
  if (!templateReference.ok) {
    return NextResponse.json(
      { error: templateReference.error },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  let resolvedPayload = payload
  if (templateReference.reference) {
    let template
    try {
      template = await getMcpTemplate(
        templateReference.reference.project,
        templateReference.reference.templateKey,
      )
    } catch (error) {
      if (error instanceof McpTemplateNotFoundError) {
        return NextResponse.json(
          { error: error.message },
          { status: 404, headers: NO_STORE_HEADERS },
        )
      }
      return NextResponse.json(
        { error: "Unable to load the selected MCP template from Kubernetes" },
        { status: 500, headers: NO_STORE_HEADERS },
      )
    }

    const resolution = resolveMcpTemplateRegistration(payload, template)
    if (!resolution.ok) {
      return NextResponse.json(
        { error: resolution.error },
        { status: 400, headers: NO_STORE_HEADERS },
      )
    }
    resolvedPayload = resolution.payload
  }

  const validation = validateMcpRegistration(resolvedPayload)
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    await createMcpResources(validation.input)
    return NextResponse.json(
      {
        server: {
          name: validation.input.mcpKeyName,
          project: validation.input.project,
        },
      },
      { status: 201, headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    if (error instanceof McpResourceConflictError) {
      return NextResponse.json(
        { error: error.message },
        { status: 409, headers: NO_STORE_HEADERS },
      )
    }

    return NextResponse.json(
      { error: "Unable to create MCP server resources" },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}
