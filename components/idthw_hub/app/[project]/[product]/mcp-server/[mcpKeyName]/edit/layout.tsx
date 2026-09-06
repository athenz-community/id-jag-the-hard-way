import type { ReactNode } from "react"
import { notFound } from "next/navigation"
import { requireHubSession } from "@/features/auth/lib/session"
import {
  getMcpServerConfiguration,
  McpResourceNotFoundError,
} from "@/features/registration/api/mcpResources"
import { McpCreateDraftProvider } from "../../create/McpCreateDraftContext"

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/

export default async function EditMcpServerLayout({
  children,
  params,
}: {
  children: ReactNode
  params: Promise<{ project: string; mcpKeyName: string }>
}) {
  await requireHubSession()
  const { project, mcpKeyName } = await params
  if (!DNS_LABEL_PATTERN.test(project) || !DNS_LABEL_PATTERN.test(mcpKeyName)) notFound()

  let server
  try {
    server = await getMcpServerConfiguration(project, mcpKeyName)
  } catch (error) {
    if (error instanceof McpResourceNotFoundError) notFound()
    throw error
  }

  return <McpCreateDraftProvider initialServer={server}>{children}</McpCreateDraftProvider>
}
