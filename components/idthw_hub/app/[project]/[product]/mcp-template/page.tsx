import { ChevronRight, ChevronsUpDown, Home, Plus } from "lucide-react"
import Link from "next/link"
import { consoleHref, displayProduct } from "@/components/navigation/consoleRoute"
import { ResourceActionMenu } from "@/components/molecules/ResourceActionMenu"
import { McpResourceLogo } from "@/components/atoms/ServerLogo"
import { ConsoleTemplate } from "@/components/templates/ConsoleTemplate"
import { requireHubSession } from "@/features/auth/lib/session"
import { CatalogFilters, CatalogPagination } from "@/features/catalog/components/CatalogPage"
import { listMcpIconOptions, resolveMcpIconSrc } from "@/features/mcp-servers/lib/mcpIcons"
import { fetchMcpTemplates } from "@/features/mcp-templates/lib/fetchTemplates"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function McpTemplateRoute({
  params,
}: {
  params: Promise<{ project: string; product: string }>
}) {
  await requireHubSession()
  const { project, product } = await params
  const [response, iconOptions] = await Promise.all([
    fetchMcpTemplates(project),
    listMcpIconOptions(),
  ])
  const catalogHref = consoleHref({ project, product, section: "catalog" })
  const templateHref = consoleHref({ project, product, section: "mcp-template" })
  const createHref = consoleHref({ project, product, section: "mcp-template", suffix: "create" })

  return (
    <ConsoleTemplate>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href={catalogHref} aria-label="Catalog home"><Home size={14} aria-hidden="true" /></Link>
        <Link href={catalogHref}>{project}</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link href={catalogHref}>{displayProduct(product)}</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link href={templateHref}><strong>MCP template</strong></Link>
      </nav>

      <div className="page-head">
        <div>
          <h1 className="page-title">MCP template</h1>
          <div className="actions" style={{ justifyContent: "flex-start", marginTop: 20 }}>
            <Link className="button mcp-create-primary" href={createHref}>
              <Plus size={14} aria-hidden="true" />
              Register template
            </Link>
          </div>
        </div>
      </div>

      <CatalogFilters />
      {response.error ? <p className="catalog-error" role="status">{response.error}</p> : null}
      <div className="catalog-table-wrap">
        <table className="catalog-table">
          <thead>
            <tr>
              <th><span className="sortable-heading">Name <ChevronsUpDown size={12} /></span></th>
              <th>Template key</th>
              <th>Source</th>
              <th>Visibility</th>
              <th>Project</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {response.templates.length > 0 ? response.templates.map((template) => (
              <tr key={template.key}>
                <td>
                  <div className="server-cell">
                    <McpResourceLogo
                      iconSrc={resolveMcpIconSrc(template.iconId, iconOptions)}
                      logoText={templateInitials(template.name)}
                    />
                    <span>{template.name}</span>
                  </div>
                </td>
                <td><code>{template.key}</code></td>
                <td>Container registry</td>
                <td>{template.visibility}</td>
                <td>{template.project}</td>
                <td>
                  <ResourceActionMenu
                    resourceKind="MCP template"
                    resourceName={template.name}
                    createServerHref={`${consoleHref({
                      project,
                      product,
                      section: "mcp-server",
                      suffix: "create",
                    })}?templateKey=${encodeURIComponent(template.key)}`}
                    editHref={consoleHref({
                      project,
                      product,
                      section: "mcp-template",
                      suffix: `${encodeURIComponent(template.key)}/edit`,
                    })}
                    deleteEndpoint={`/api/mcp-templates/${encodeURIComponent(template.key)}?project=${encodeURIComponent(project)}`}
                  />
                </td>
              </tr>
            )) : (
              <tr><td className="empty-cell" colSpan={6}>No MCP templates found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <CatalogPagination />
    </ConsoleTemplate>
  )
}

function templateInitials(name: string) {
  return name
    .split(/[-_\s]+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}
