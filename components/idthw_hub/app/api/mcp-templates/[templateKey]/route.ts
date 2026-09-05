import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/features/auth/lib/auth"
import {
  getMcpTemplate,
  McpTemplateNotFoundError,
} from "@/features/mcp-templates/api/kubernetesTemplates"
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
