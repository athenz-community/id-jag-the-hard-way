import { ChevronRight, Home } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { consoleHref, displayProduct } from "@/components/navigation/consoleRoute"
import { ConsoleTemplate } from "@/components/templates/ConsoleTemplate"
import { McpCreateSteps } from "../../create/McpCreateSteps"
import { ConfigurationForm } from "../../create/configuration/ConfigurationForm"
import { ConfirmSummary } from "../../create/confirm/ConfirmSummary"
import { EditSourceForm } from "./EditSourceForm"

export type EditMcpServerStep = "source" | "configuration" | "confirm"

export async function EditMcpServerPage({
  activeStep,
  params,
}: {
  activeStep: EditMcpServerStep
  params: Promise<{ project: string; product: string; mcpKeyName: string }>
}) {
  const { project, product, mcpKeyName } = await params
  const catalogHref = consoleHref({ project, product, section: "catalog" })
  const mcpServerHref = consoleHref({ project, product, section: "mcp-server" })
  const editSuffix = `${encodeURIComponent(mcpKeyName)}/edit`
  const sourceHref = consoleHref({ project, product, section: "mcp-server", suffix: editSuffix })
  const configurationHref = consoleHref({ project, product, section: "mcp-server", suffix: `${editSuffix}/configuration` })
  const confirmHref = consoleHref({ project, product, section: "mcp-server", suffix: `${editSuffix}/confirm` })
  const hubServiceDomain = `mcp-hub.mcps.${project}`
  const athenzUiUrl = (process.env.MCP_HUB_ATHENZ_UI_URL ?? "http://localhost:3000").replace(/\/+$/, "")
  const athenzServicesHref = `${athenzUiUrl}/domain/${encodeURIComponent(hubServiceDomain)}/service`

  let form: ReactNode
  if (activeStep === "source") {
    form = <EditSourceForm cancelHref={mcpServerHref} configurationHref={configurationHref} />
  } else if (activeStep === "configuration") {
    form = (
      <ConfigurationForm
        project={project}
        athenzServicesHref={athenzServicesHref}
        cancelHref={mcpServerHref}
        sourceHref={sourceHref}
        confirmHref={confirmHref}
        mode="edit"
      />
    )
  } else {
    form = (
      <ConfirmSummary
        project={project}
        cancelHref={mcpServerHref}
        successHref={mcpServerHref}
        sourceHref={sourceHref}
        configurationHref={configurationHref}
        mode="edit"
        originalMcpKeyName={mcpKeyName}
      />
    )
  }

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
        <strong>Edit MCP server</strong>
      </nav>

      <div className="page-head">
        <h1 className="page-title">Edit MCP server</h1>
      </div>

      <div className="mcp-create-layout">
        <McpCreateSteps
          activeStep={activeStep}
          sourceHref={sourceHref}
          configurationHref={configurationHref}
        />
        {form}
      </div>
    </ConsoleTemplate>
  )
}
