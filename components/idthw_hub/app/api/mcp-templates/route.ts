import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/features/auth/lib/auth"
import {
  createMcpTemplate,
  listMcpTemplates,
  McpTemplateConflictError,
} from "@/features/mcp-templates/api/kubernetesTemplates"
import { validateMcpTemplate } from "@/features/mcp-templates/lib/templateInput"
import type { McpTemplateListResponse } from "@/features/mcp-templates/types"

export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = { "Cache-Control": "no-store" }
const PROJECT_PATTERN = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json<McpTemplateListResponse>(
      { templates: [], error: "Authentication required" },
      { status: 401, headers: NO_STORE_HEADERS },
    )
  }

  const project = request.nextUrl.searchParams.get("project") ?? ""
  if (!PROJECT_PATTERN.test(project)) {
    return NextResponse.json<McpTemplateListResponse>(
      { templates: [], error: "Invalid project" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    return NextResponse.json<McpTemplateListResponse>(
      { templates: await listMcpTemplates(project) },
      { headers: NO_STORE_HEADERS },
    )
  } catch {
    return NextResponse.json<McpTemplateListResponse>(
      { templates: [], error: "Unable to load MCP templates from Kubernetes" },
      { headers: NO_STORE_HEADERS },
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
      { error: "Invalid MCP template request" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  const validation = validateMcpTemplate(payload)
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    await createMcpTemplate(validation.input)
    return NextResponse.json(
      { template: { key: validation.input.templateKey, project: validation.input.project } },
      { status: 201, headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    if (error instanceof McpTemplateConflictError) {
      return NextResponse.json(
        { error: error.message },
        { status: 409, headers: NO_STORE_HEADERS },
      )
    }
    return NextResponse.json(
      { error: "Unable to create MCP template" },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}
