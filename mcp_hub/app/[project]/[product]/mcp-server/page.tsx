import { ChevronRight, Home, Plus } from "lucide-react"
import Link from "next/link"
import { consoleHref, displayProduct } from "@/components/navigation/consoleRoute"
import { ConsoleTemplate } from "@/components/templates/ConsoleTemplate"
import { requireHubSession } from "@/features/auth/lib/session"
import {
  CatalogError,
  CatalogFilters,
  CatalogPagination,
  CatalogTable,
} from "@/features/catalog/components/CatalogPage"
import { fetchCatalog } from "@/features/catalog/lib/fetchCatalog"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function ProjectMcpServerRoute({
  params,
}: {
  params: Promise<{ project: string; product: string }>
}) {
  await requireHubSession()
  const { project, product } = await params
  const catalog = await fetchCatalog()
  const projectServers = catalog.servers.filter((server) => server.project === project)
  const catalogHref = consoleHref({ project, product, section: "catalog" })
  const mcpServerHref = consoleHref({ project, product, section: "mcp-server" })
  const createHref = consoleHref({ project, product, section: "mcp-server", suffix: "create" })

  return (
    <ConsoleTemplate>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href={catalogHref} aria-label="Catalog home"><Home size={14} aria-hidden="true" /></Link>
        <Link href={catalogHref}>{project}</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link href={catalogHref}>{displayProduct(product)}</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link href={mcpServerHref}><strong>MCP server</strong></Link>
      </nav>
      <div className="page-head">
        <div>
          <h1 className="page-title">MCP server</h1>
          <div className="actions" style={{ justifyContent: "flex-start", marginTop: 20 }}>
            <Link className="button" href={createHref} style={{ textDecoration: "none" }}>
              <Plus size={14} aria-hidden="true" />
              Create MCP server
            </Link>
          </div>
        </div>
      </div>
      <CatalogFilters />
      <CatalogError error={catalog.error} />
      <CatalogTable servers={projectServers} project={project} product={product} />
      <CatalogPagination />
    </ConsoleTemplate>
  )
}
