import { notFound } from "next/navigation"
import { ConsoleTemplate } from "@/components/templates/ConsoleTemplate"
import { decodeRouteParam } from "@/components/navigation/consoleRoute"
import {
  JsonConfigurationSection,
  McpServerDetailBreadcrumb,
  McpServerDetailHeader,
  McpServerDetailTabs,
  McpServerUrlSection,
} from "@/features/catalog/components/McpServerClientConfigurationPage"
import { fetchCatalog } from "@/features/catalog/lib/fetchCatalog"
import { resolveMcpDisplayUrl } from "@/features/catalog/lib/mcpTools"
import { requireHubSession } from "@/features/auth/lib/session"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function McpServerClientConfigurationRoute({
  params,
}: {
  params: Promise<{ project: string; product: string; id: string }>
}) {
  await requireHubSession()
  const { project, product, id } = await params
  const serverId = decodeRouteParam(id)
  const catalog = await fetchCatalog()
  const server = catalog.servers.find((item) => item.id === serverId)

  if (!server) notFound()

  const displayName = server.alias ?? server.name
  const mcpServerUrl = resolveMcpDisplayUrl(server)

  return (
    <ConsoleTemplate>
      <McpServerDetailBreadcrumb project={project} product={product} displayName={displayName} currentView="Client configuration" />
      <McpServerDetailHeader project={project} product={product} server={server} displayName={displayName} />
      <McpServerDetailTabs project={project} product={product} serverId={server.id} active="client-configuration" />
      <McpServerUrlSection mcpServerUrl={mcpServerUrl} />
      <JsonConfigurationSection serverName={server.routeId} mcpServerUrl={mcpServerUrl} />
    </ConsoleTemplate>
  )
}
