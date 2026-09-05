import { ChevronRight, Home } from "lucide-react"
import Link from "next/link"
import { consoleHref, displayProduct } from "@/components/navigation/consoleRoute"
import { ConsoleTemplate } from "@/components/templates/ConsoleTemplate"
import { requireHubSession } from "@/features/auth/lib/session"
import { McpTemplateCreateSteps } from "../McpTemplateCreateSteps"
import { ConfirmSummary } from "./ConfirmSummary"

export const dynamic = "force-dynamic"

export default async function ConfirmMcpTemplateRoute({
  params,
}: {
  params: Promise<{ project: string; product: string }>
}) {
  await requireHubSession()
  const { project, product } = await params
  const catalogHref = consoleHref({ project, product, section: "catalog" })
  const templateHref = consoleHref({ project, product, section: "mcp-template" })
  const createHref = consoleHref({ project, product, section: "mcp-template", suffix: "create" })
  const configurationHref = consoleHref({ project, product, section: "mcp-template", suffix: "create/configuration" })
  const referenceHref = consoleHref({ project, product, section: "mcp-template", suffix: "create/reference" })

  return (
    <ConsoleTemplate>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href={catalogHref} aria-label="Catalog home"><Home size={14} aria-hidden="true" /></Link>
        <Link href={catalogHref}>{project}</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link href={catalogHref}>{displayProduct(product)}</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link href={templateHref}>MCP template</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <strong>Register template</strong>
      </nav>

      <div className="page-head">
        <h1 className="page-title">Register MCP template</h1>
      </div>

      <div className="mcp-create-layout">
        <McpTemplateCreateSteps
          activeStep="confirm"
          sourceHref={createHref}
          configurationHref={configurationHref}
          referenceHref={referenceHref}
        />
        <ConfirmSummary
          project={project}
          cancelHref={templateHref}
          successHref={templateHref}
          sourceHref={createHref}
          configurationHref={configurationHref}
          referenceHref={referenceHref}
        />
      </div>
    </ConsoleTemplate>
  )
}
