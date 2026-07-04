import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
  Filter,
  Home,
  MoreHorizontal,
  Search,
} from "lucide-react"
import Link from "next/link"
import { ServerLogo } from "@/components/atoms/ServerLogo"
import { consoleHref, displayProduct } from "@/components/navigation/consoleRoute"
import type { McpServer } from "@/features/catalog/types/catalog"

export function CatalogBreadcrumb({ project, product }: { project: string; product: string }) {
  const catalogHref = consoleHref({ project, product, section: "catalog" })

  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <Link href={catalogHref} aria-label="Catalog home">
        <Home size={14} aria-hidden="true" />
      </Link>
      <Link href={catalogHref}>{project}</Link>
      <ChevronRight size={14} aria-hidden="true" />
      <Link href={catalogHref}>{displayProduct(product)}</Link>
      <ChevronRight size={14} aria-hidden="true" />
      <Link href={catalogHref}>Catalog</Link>
      <ChevronRight size={14} aria-hidden="true" />
      <strong>Public MCP server</strong>
    </nav>
  )
}

export function CatalogHeader() {
  return (
    <div className="page-head">
      <div>
        <h1 className="page-title">Catalog</h1>
      </div>

      <div className="actions">
        <button className="button" type="button" disabled>
          <ClipboardList size={14} aria-hidden="true" />
          Document
        </button>
      </div>
    </div>
  )
}

export function CatalogTabs() {
  return (
    <div className="tabs" aria-label="Catalog filters">
      <button className="tab active" type="button">
        Public MCP server
      </button>
      <button className="tab" type="button" disabled>
        Public MCP template
      </button>
    </div>
  )
}

export function CatalogFilters() {
  return (
    <div className="filter-row">
      <div className="filter-label">
        <Filter size={17} aria-hidden="true" />
        Filter
      </div>
      <button className="filter-select" type="button" disabled>
        Name
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <label className="search-box">
        <Search size={15} aria-hidden="true" />
        <span className="sr-only">Keyword</span>
        <input type="text" placeholder="Enter keyword" disabled />
      </label>
      <button className="add-filter-button" type="button" disabled>
        Add
      </button>
    </div>
  )
}

export function CatalogError({ error }: { error?: string }) {
  if (!error) return null

  return (
    <p className="catalog-error" role="status">
      Catalog API could not load Kubernetes deployments: {error}
    </p>
  )
}

export function CatalogTable({ servers, project, product }: { servers: McpServer[]; project: string; product: string }) {
  return (
    <div className="catalog-table-wrap">
      <table className="catalog-table">
        <thead>
          <tr>
            <th>
              <span className="sortable-heading">
                Name <ChevronsUpDown size={12} aria-hidden="true" />
              </span>
            </th>
            <th>Description</th>
            <th>Project</th>
            <th>
              <span className="sortable-heading">
                Total tool calls <ChevronsUpDown size={12} aria-hidden="true" />
              </span>
            </th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {servers.length > 0 ? (
            servers.map((server) => (
              <tr key={server.id}>
                <td>
                  <div className="server-cell">
                    <ServerLogo server={server} />
                    <Link
                      className="server-name"
                      href={consoleHref({
                        project,
                        product,
                        section: "catalog",
                        suffix: `${server.id}/client-configuration`,
                      })}
                    >
                      {server.alias ?? server.name}
                    </Link>
                  </div>
                </td>
                <td>{server.description}</td>
                <td>{server.project}</td>
                <td>{server.totalToolCalls}</td>
                <td>
                  <button className="table-action" aria-label={`Open actions for ${server.name}`} type="button" disabled>
                    <MoreHorizontal size={16} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))
          ) : (
            <tr>
              <td className="empty-cell" colSpan={5}>
                No MCP server deployments found.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export function CatalogPagination() {
  return (
    <div className="pagination-row">
      <button className="page-size" type="button" disabled>
        50 / page
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      <div className="pager" aria-label="Pagination">
        <button type="button" disabled>
          |&lt;
        </button>
        <button type="button" disabled>
          &lt;
        </button>
        <button className="active-page" type="button">
          1
        </button>
        <button type="button" disabled>
          &gt;
        </button>
        <button type="button" disabled>
          &gt;|
        </button>
      </div>
    </div>
  )
}
