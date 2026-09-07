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
import { listLiveMcpTools, resolveMcpDisplayUrl } from "@/features/catalog/lib/mcpTools"
import { requireHubSession } from "@/features/auth/lib/session"
import { McpManagedClientConfiguration } from "@/features/permissions/components/McpManagedClientConfiguration"
import { PermissionReadinessSection } from "@/features/permissions/components/PermissionReadinessSection"
import { fetchPermissionReadiness } from "@/features/permissions/lib/fetchPermissionReadiness"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function McpServerClientConfigurationRoute({
  params,
}: {
  params: Promise<{ project: string; product: string; id: string }>
}) {
  const session = await requireHubSession()
  const { project, product, id } = await params
  const serverId = decodeRouteParam(id)
  const catalog = await fetchCatalog()
  const server = catalog.servers.find((item) => item.id === serverId)

  if (!server) notFound()

  const displayName = server.alias ?? server.name
  const mcpServerUrl = resolveMcpDisplayUrl(server)
  const usesHubManagedAccess = server.accessManagement === "hub"
  const [permissionReadiness, toolsResult] = await Promise.all([
    fetchPermissionReadiness(
      server.routeId,
      session.user.username,
      server.accessScope,
      server.accessAudience,
      server.toolPermissionOverrides,
      server.serviceAccount,
    ),
    listLiveMcpTools(server),
  ])
  const permissionCheck = (
    <PermissionReadinessSection
      accessAudience={server.accessAudience}
      mcpKeyName={server.name}
      project={server.namespace}
      servicePrincipal={server.serviceAccount}
      stepNumber={usesHubManagedAccess ? 2 : 1}
      readiness={permissionReadiness}
      toolsResult={toolsResult}
    />
  )

  return (
    <ConsoleTemplate>
      <McpServerDetailBreadcrumb project={project} product={product} displayName={displayName} currentView="Client configuration" />
      <McpServerDetailHeader project={project} product={product} server={server} displayName={displayName} />
      <McpServerDetailTabs project={project} product={product} serverId={server.id} active="client-configuration" />
      <McpServerUrlSection mcpServerUrl={mcpServerUrl} />
      <JsonConfigurationSection
        clientConfiguration={usesHubManagedAccess ? (
          <McpManagedClientConfiguration
            currentAccessScope={server.accessScope}
            displayName={displayName}
            mcpKeyName={server.name}
            mcpServerUrl={mcpServerUrl}
            permissionCheck={permissionCheck}
            project={server.namespace}
            readiness={permissionReadiness}
            serverName={server.routeId}
            username={session.user.username}
          />
        ) : undefined}
        serverName={server.routeId}
        mcpServerUrl={mcpServerUrl}
        permissionCheck={permissionCheck}
      />
    </ConsoleTemplate>
  )
}
