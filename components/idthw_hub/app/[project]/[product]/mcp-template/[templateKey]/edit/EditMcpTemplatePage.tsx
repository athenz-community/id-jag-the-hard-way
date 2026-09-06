import { ChevronRight, Home } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { consoleHref, displayProduct } from "@/components/navigation/consoleRoute"
import { ConsoleTemplate } from "@/components/templates/ConsoleTemplate"
import { ConfirmSummary } from "../../create/confirm/ConfirmSummary"
import { ConfigurationForm } from "../../create/configuration/ConfigurationForm"
import { McpTemplateCreateSteps, type McpTemplateStep } from "../../create/McpTemplateCreateSteps"
import { ReferenceForm } from "../../create/reference/ReferenceForm"
import { SourceForm } from "../../create/SourceForm"

export async function EditMcpTemplatePage({
  activeStep,
  params,
}: {
  activeStep: McpTemplateStep
  params: Promise<{ project: string; product: string; templateKey: string }>
}) {
  const { project, product, templateKey } = await params
  const catalogHref = consoleHref({ project, product, section: "catalog" })
  const templateHref = consoleHref({ project, product, section: "mcp-template" })
  const editSuffix = `${encodeURIComponent(templateKey)}/edit`
  const sourceHref = consoleHref({ project, product, section: "mcp-template", suffix: editSuffix })
  const configurationHref = consoleHref({ project, product, section: "mcp-template", suffix: `${editSuffix}/configuration` })
  const referenceHref = consoleHref({ project, product, section: "mcp-template", suffix: `${editSuffix}/reference` })
  const confirmHref = consoleHref({ project, product, section: "mcp-template", suffix: `${editSuffix}/confirm` })

  let form: ReactNode
  if (activeStep === "source") {
    form = <SourceForm cancelHref={templateHref} configurationHref={configurationHref} />
  } else if (activeStep === "configuration") {
    form = (
      <ConfigurationForm
        cancelHref={templateHref}
        sourceHref={sourceHref}
        referenceHref={referenceHref}
        templateKeyReadOnly
      />
    )
  } else if (activeStep === "reference") {
    form = (
      <ReferenceForm
        project={project}
        cancelHref={templateHref}
        configurationHref={configurationHref}
        confirmHref={confirmHref}
      />
    )
  } else {
    form = (
      <ConfirmSummary
        project={project}
        cancelHref={templateHref}
        successHref={templateHref}
        sourceHref={sourceHref}
        configurationHref={configurationHref}
        referenceHref={referenceHref}
        mode="edit"
        originalTemplateKey={templateKey}
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
        <Link href={templateHref}>MCP template</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <strong>Edit template</strong>
      </nav>

      <div className="page-head">
        <h1 className="page-title">Edit MCP template</h1>
      </div>

      <div className="mcp-create-layout">
        <McpTemplateCreateSteps
          activeStep={activeStep}
          sourceHref={sourceHref}
          configurationHref={configurationHref}
          referenceHref={referenceHref}
          mode="edit"
        />
        {form}
      </div>
    </ConsoleTemplate>
  )
}
