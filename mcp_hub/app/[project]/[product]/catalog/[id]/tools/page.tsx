import { notFound } from "next/navigation"
import { ConsoleTemplate } from "@/components/templates/ConsoleTemplate"
import {
  McpServerDetailBreadcrumb,
  McpServerDetailHeader,
  McpServerDetailTabs,
} from "@/features/catalog/components/McpServerClientConfigurationPage"
import { ToolsFilter, ToolsList, ToolsLoadStatus } from "@/features/catalog/components/McpServerToolsPage"
import { fetchCatalog } from "@/features/catalog/lib/fetchCatalog"
import { listLiveMcpTools } from "@/features/catalog/lib/mcpTools"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function McpServerToolsRoute({ params }: { params: Promise<{ project: string; product: string; id: string }> }) {
  const { project, product, id } = await params
  const catalog = await fetchCatalog()
  const server = catalog.servers.find((item) => item.id === id)

  if (!server) notFound()

  const displayName = server.alias ?? server.name
  const toolsResult = await listLiveMcpTools(server)

  return (
    <ConsoleTemplate>
      <McpServerDetailBreadcrumb project={project} product={product} displayName={displayName} />
      <McpServerDetailHeader project={project} product={product} server={server} displayName={displayName} />
      <McpServerDetailTabs project={project} product={product} serverId={server.id} active="tools" />
      <ToolsFilter />
      <ToolsLoadStatus endpoint={toolsResult.endpoint} error={toolsResult.error} />
      <ToolsList tools={toolsResult.tools} />
    </ConsoleTemplate>
  )
}
