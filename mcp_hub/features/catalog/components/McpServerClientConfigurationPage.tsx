import { ChevronLeft, ChevronRight, ClipboardList, Home } from "lucide-react"
import Link from "next/link"
import { CopyButton } from "@/components/atoms/CopyButton"
import { ServerLogo } from "@/components/atoms/ServerLogo"
import { consoleHref, displayProduct } from "@/components/navigation/consoleRoute"
import { ClientConfiguration } from "@/components/molecules/ClientConfiguration"
import type { McpServer } from "@/features/catalog/types/catalog"

export function McpServerDetailBreadcrumb({
  project,
  product,
  displayName,
  currentView,
}: {
  project: string
  product: string
  displayName: string
  currentView: string
}) {
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
      <Link href={catalogHref}>Public MCP server</Link>
      <ChevronRight size={14} aria-hidden="true" />
      <span>{displayName}</span>
      <ChevronRight size={14} aria-hidden="true" />
      <strong>{currentView}</strong>
    </nav>
  )
}

export function McpServerDetailHeader({
  project,
  product,
  server,
  displayName,
}: {
  project: string
  product: string
  server: McpServer
  displayName: string
}) {
  return (
    <div className="detail-page-head">
      <div className="detail-title-row">
        <Link className="back-link" href={consoleHref({ project, product, section: "catalog" })} aria-label="Back to catalog">
          <ChevronLeft size={20} aria-hidden="true" />
        </Link>
        <ServerLogo server={server} />
        <h1 className="detail-title">{displayName}</h1>
        <span className="status-badge">Active</span>
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

export function McpServerDetailTabs({
  project,
  product,
  serverId,
  active,
}: {
  project: string
  product: string
  serverId: string
  active: "client-configuration" | "tools"
}) {
  return (
    <div className="tabs detail-tabs" aria-label="MCP server detail views">
      <Link
        className={`tab ${active === "client-configuration" ? "active" : ""}`}
        href={consoleHref({ project, product, section: "catalog", suffix: `${serverId}/client-configuration` })}
      >
        Client configuration
      </Link>
      <button className="tab" type="button" disabled>
        Overview
      </button>
      <Link
        className={`tab ${active === "tools" ? "active" : ""}`}
        href={consoleHref({ project, product, section: "catalog", suffix: `${serverId}/tools` })}
      >
        Tools
      </Link>
    </div>
  )
}

export function McpServerUrlSection({ mcpServerUrl }: { mcpServerUrl: string }) {
  return (
    <section className="detail-section" aria-labelledby="mcp-server-heading">
      <h2 id="mcp-server-heading" className="section-title">
        MCP server
      </h2>
      <div className="url-card">
        <div className="url-label">URL</div>
        <div className="url-value-row">
          <code>{mcpServerUrl}</code>
          <CopyButton value={mcpServerUrl} label="Copy MCP server URL" />
        </div>
      </div>
    </section>
  )
}

export function JsonConfigurationSection({ serverName, mcpServerUrl }: { serverName: string; mcpServerUrl: string }) {
  return (
    <section className="detail-section config-section" aria-labelledby="json-config-heading">
      <h2 id="json-config-heading" className="section-title">
        JSON configuration
      </h2>
      <p className="section-copy">Add this configuration to your MCP client settings.</p>

      <ClientConfiguration serverName={serverName} mcpServerUrl={mcpServerUrl} />
    </section>
  )
}
