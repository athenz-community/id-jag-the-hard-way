import { notFound } from "next/navigation"
import { ConsoleTemplate } from "@/components/templates/ConsoleTemplate"
import {
  JsonConfigurationSection,
  McpServerDetailBreadcrumb,
  McpServerDetailHeader,
  McpServerDetailTabs,
  McpServerUrlSection,
} from "@/features/catalog/components/McpServerClientConfigurationPage"
import { fetchCatalog } from "@/features/catalog/lib/fetchCatalog"

export const dynamic = "force-dynamic"
export const revalidate = 0

const MCP_NAMESPACE = "mcp-hub"

export default async function McpServerClientConfigurationRoute({
  params,
}: {
  params: Promise<{ project: string; product: string; id: string }>
}) {
  const { project, product, id } = await params
  const catalog = await fetchCatalog()
  const server = catalog.servers.find((item) => item.id === id)

  if (!server) notFound()

  const displayName = server.alias ?? server.name
  const mcpServerUrl = `http://${server.name}.${MCP_NAMESPACE}:8081/mcp`

  return (
    <ConsoleTemplate>
      <McpServerDetailBreadcrumb project={project} product={product} displayName={displayName} />
      <McpServerDetailHeader project={project} product={product} server={server} displayName={displayName} />
      <McpServerDetailTabs />
      <McpServerUrlSection mcpServerUrl={mcpServerUrl} />
      <JsonConfigurationSection serverName={server.name} mcpServerUrl={mcpServerUrl} />
    </ConsoleTemplate>
  )
}
