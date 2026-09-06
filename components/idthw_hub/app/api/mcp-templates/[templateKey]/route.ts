import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/features/auth/lib/auth"
import { KubectlCommandError } from "@/features/kubernetes/api/kubectl"
import {
  getMcpTemplate,
  McpTemplateNotFoundError,
  updateMcpTemplate,
} from "@/features/mcp-templates/api/kubernetesTemplates"
import { validateMcpTemplate } from "@/features/mcp-templates/lib/templateInput"
import type { McpTemplateDetailResponse } from "@/features/mcp-templates/types"

export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = { "Cache-Control": "no-store" }
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ templateKey: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json<McpTemplateDetailResponse>(
      { error: "Authentication required" },
      { status: 401, headers: NO_STORE_HEADERS },
    )
  }

  const { templateKey } = await params
  const project = request.nextUrl.searchParams.get("project") ?? ""
  if (!DNS_LABEL_PATTERN.test(project) || !DNS_LABEL_PATTERN.test(templateKey)) {
    return NextResponse.json<McpTemplateDetailResponse>(
      { error: "Invalid MCP template reference" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    return NextResponse.json<McpTemplateDetailResponse>(
      { template: await getMcpTemplate(project, templateKey) },
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    if (error instanceof McpTemplateNotFoundError) {
      return NextResponse.json<McpTemplateDetailResponse>(
        { error: error.message },
        { status: 404, headers: NO_STORE_HEADERS },
      )
    }
    return NextResponse.json<McpTemplateDetailResponse>(
      { error: "Unable to load MCP template from Kubernetes" },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ templateKey: string }> },
) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401, headers: NO_STORE_HEADERS },
    )
  }

  const { templateKey } = await params
  const project = request.nextUrl.searchParams.get("project") ?? ""
  if (!DNS_LABEL_PATTERN.test(project) || !DNS_LABEL_PATTERN.test(templateKey)) {
    return NextResponse.json(
      { error: "Invalid MCP template reference" },
      { status: 400, headers: NO_STORE_HEADERS },
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
  if (validation.input.project !== project || validation.input.templateKey !== templateKey) {
    return NextResponse.json(
      { error: "MCP template identity cannot be changed" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  try {
    await updateMcpTemplate(validation.input)
    return NextResponse.json(
      { template: { key: templateKey, project } },
      { headers: NO_STORE_HEADERS },
    )
  } catch (error) {
    if (error instanceof McpTemplateNotFoundError) {
      return NextResponse.json(
        { error: error.message },
        { status: 404, headers: NO_STORE_HEADERS },
      )
    }
    const detail = updateErrorDetail(error)
    console.error("Unable to update MCP template", { project, templateKey, detail })
    return NextResponse.json(
      { error: detail ? `Unable to update MCP template: ${detail}` : "Unable to update MCP template" },
      { status: 500, headers: NO_STORE_HEADERS },
    )
  }
}

function updateErrorDetail(error: unknown) {
  const detail = error instanceof KubectlCommandError
    ? error.stderr
    : error instanceof Error
      ? error.message
      : ""
  return detail.trim().replace(/\s+/g, " ").slice(0, 500)
}
