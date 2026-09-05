import { ChevronRight, Home } from "lucide-react"
import Link from "next/link"
import { consoleHref, displayProduct } from "@/components/navigation/consoleRoute"
import { ConsoleTemplate } from "@/components/templates/ConsoleTemplate"
import { requireHubSession } from "@/features/auth/lib/session"
import { McpCreateSteps } from "../McpCreateSteps"
import { ConfirmSummary } from "./ConfirmSummary"

export const dynamic = "force-dynamic"

export default async function ConfirmMcpServerRoute({
  params,
}: {
  params: Promise<{ project: string; product: string }>
}) {
  await requireHubSession()
  const { project, product } = await params
  const catalogHref = consoleHref({ project, product, section: "catalog" })
  const mcpServerHref = consoleHref({ project, product, section: "mcp-server" })
  const createHref = consoleHref({ project, product, section: "mcp-server", suffix: "create" })
  const configurationHref = consoleHref({ project, product, section: "mcp-server", suffix: "create/configuration" })

  return (
    <ConsoleTemplate>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href={catalogHref} aria-label="Catalog home"><Home size={14} aria-hidden="true" /></Link>
        <Link href={catalogHref}>{project}</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link href={catalogHref}>{displayProduct(product)}</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link href={mcpServerHref}>MCP server</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <strong>Create MCP server</strong>
      </nav>

      <div className="page-head">
        <h1 className="page-title">Create MCP server</h1>
      </div>

      <div className="mcp-create-layout">
        <McpCreateSteps activeStep="confirm" sourceHref={createHref} configurationHref={configurationHref} />
        <ConfirmSummary
          project={project}
          cancelHref={mcpServerHref}
          successHref={mcpServerHref}
          sourceHref={createHref}
          configurationHref={configurationHref}
        />
      </div>
    </ConsoleTemplate>
  )
}
