import type { ReactNode } from "react"
import { notFound } from "next/navigation"
import { requireHubSession } from "@/features/auth/lib/session"
import {
  getMcpTemplate,
  McpTemplateNotFoundError,
} from "@/features/mcp-templates/api/kubernetesTemplates"
import { McpTemplateDraftProvider } from "../../create/McpTemplateDraftContext"

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/

export default async function EditMcpTemplateLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ project: string; templateKey: string }>
}) {
  await requireHubSession()
  const { project, templateKey } = await params
  if (!DNS_LABEL_PATTERN.test(project) || !DNS_LABEL_PATTERN.test(templateKey)) notFound()

  let template
  try {
    template = await getMcpTemplate(project, templateKey)
  } catch (error) {
    if (error instanceof McpTemplateNotFoundError) notFound()
    throw error
  }

  return <McpTemplateDraftProvider initialTemplate={template}>{children}</McpTemplateDraftProvider>
}
