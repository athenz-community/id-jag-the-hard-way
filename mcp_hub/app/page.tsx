import {
  Bell,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  ClipboardList,
  Filter,
  Grip,
  HelpCircle,
  Home,
  MoreHorizontal,
  Search,
  Sparkles,
  TerminalSquare,
} from "lucide-react"
import Image from "next/image"

type McpServer = {
  id: string
  name: string
  description: string
  project: string
  totalToolCalls: string
  iconSrc?: string
  logoText: string
  logoBg: string
  logoFg: string
}

const servers: McpServer[] = [
  {
    id: "confluence",
    name: "confluence",
    description: "The MCP server for Confluence",
    project: "confluence",
    totalToolCalls: "N/A",
    iconSrc: "/icons/confluence.png",
    logoText: "CF",
    logoBg: "#2d7ff9",
    logoFg: "#ffffff",
  },
  {
    id: "doc-server",
    name: "doc-server",
    description: "The MCP server for ID-JAG tutorial documents",
    project: "k8s-docs-server",
    totalToolCalls: "N/A",
    logoText: "DS",
    logoBg: "#ffffff",
    logoFg: "#111111",
  },
  {
    id: "athenz",
    name: "athenz",
    description: "The MCP server for Athenz",
    project: "athenz",
    totalToolCalls: "N/A",
    iconSrc: "/icons/athenz.png",
    logoText: "AZ",
    logoBg: "#111111",
    logoFg: "#ffffff",
  },
]

export default function McpHubPage() {
  return (
    <main className="console-shell">
      <header className="top-header">
        <div className="header-left">
          <div className="logo-mark" aria-label="IDTHW">
            <Image src="/icons/cloud.png" alt="" width={28} height={28} className="brand-logo-image" />
            <span className="logo-text">IDTHW</span>
          </div>
          <button className="env-select" type="button" disabled>
            <span className="select-name">Dev</span>
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          <button className="context-select" type="button" disabled>
            <span className="select-type">Project</span>
            <span className="select-name">
              k8s-docs-server
              <ChevronDown size={12} aria-hidden="true" />
            </span>
          </button>
          <button className="context-select" type="button" disabled>
            <span className="select-type">Product</span>
            <span className="select-name">
              MCP hub
              <ChevronDown size={12} aria-hidden="true" />
            </span>
          </button>
        </div>

        <div className="header-right">
          <button className="region-select" type="button" disabled>
            <span className="select-type">Region</span>
            <span className="select-name">local</span>
          </button>
          <button className="icon-button" aria-label="AI assistant" type="button" disabled>
            <Sparkles size={16} aria-hidden="true" />
          </button>
          <button className="icon-button" aria-label="Cloud shell" type="button" disabled>
            <TerminalSquare size={16} aria-hidden="true" />
          </button>
          <button className="icon-button" aria-label="Notifications" type="button" disabled>
            <Bell size={16} aria-hidden="true" />
          </button>
          <div className="avatar" aria-label="Current user">
            A
          </div>
          <button className="icon-button" aria-label="App menu" type="button" disabled>
            <Grip size={16} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="app-body">
        <aside className="sidebar" aria-label="MCP Hub navigation">
          <div className="sidebar-product">
            <Sparkles size={16} aria-hidden="true" />
            MCP hub
          </div>
          <a className="sidebar-link active" href="#">
            Catalog
          </a>
          <button className="sidebar-link" type="button" disabled>
            MCP server
          </button>
          <button className="sidebar-link" type="button" disabled>
            MCP template
          </button>
          <button className="sidebar-link" type="button" disabled>
            Playground
          </button>
          <button className="sidebar-link" type="button" disabled>
            Approval
          </button>
          <div className="sidebar-divider" />
          <button className="sidebar-support" type="button" disabled>
            <ClipboardList size={14} aria-hidden="true" />
            Document
          </button>
          <button className="sidebar-support" type="button" disabled>
            <HelpCircle size={14} aria-hidden="true" />
            Help channel
          </button>
        </aside>

        <section className="main-content">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <Home size={14} aria-hidden="true" />
            <span>k8s-docs-server</span>
            <ChevronRight size={14} aria-hidden="true" />
            <span>Catalog</span>
            <ChevronRight size={14} aria-hidden="true" />
            <strong>Public MCP server</strong>
          </nav>

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

          <div className="tabs" aria-label="Catalog filters">
            <button className="tab active" type="button">
              Public MCP server
            </button>
            <button className="tab" type="button" disabled>
              Public MCP template
            </button>
          </div>

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

          <div className="catalog-table-wrap">
            <table className="catalog-table">
              <thead>
                <tr>
                  <th>
                    <span className="sortable-heading">Name <ChevronsUpDown size={12} aria-hidden="true" /></span>
                  </th>
                  <th>Description</th>
                  <th>Project</th>
                  <th>
                    <span className="sortable-heading">Total tool calls <ChevronsUpDown size={12} aria-hidden="true" /></span>
                  </th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((server) => (
                  <tr key={server.id}>
                    <td>
                      <div className="server-cell">
                        <div
                          className={`server-logo ${server.iconSrc ? "image-logo" : "text-logo"}`}
                          style={{
                            "--logo-bg": server.logoBg,
                            "--logo-fg": server.logoFg,
                          } as React.CSSProperties}
                        >
                          {server.iconSrc ? (
                            <Image src={server.iconSrc} alt="" width={24} height={24} className="server-logo-image" />
                          ) : (
                            server.logoText
                          )}
                        </div>
                        <a className="server-name" href="#">
                          {server.name}
                        </a>
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
                ))}
              </tbody>
            </table>
          </div>

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
        </section>
      </div>
    </main>
  )
}
