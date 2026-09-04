import { ChevronRight, Home } from "lucide-react"
import Link from "next/link"
import { consoleHref, displayProduct } from "@/components/navigation/consoleRoute"
import { ConsoleTemplate } from "@/components/templates/ConsoleTemplate"
import { requireHubSession } from "@/features/auth/lib/session"
import { ContainerImageField } from "./ContainerImageField"

export const dynamic = "force-dynamic"

export default async function CreateMcpServerRoute({
  params,
}: {
  params: Promise<{ project: string; product: string }>
}) {
  await requireHubSession()
  const { project, product } = await params
  const catalogHref = consoleHref({ project, product, section: "catalog" })
  const mcpServerHref = consoleHref({ project, product, section: "mcp-server" })

  return (
    <ConsoleTemplate>
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        <Link href={catalogHref} aria-label="Catalog home"><Home size={14} aria-hidden="true" /></Link>
        <Link href={catalogHref}>{project}</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link href={catalogHref}>{displayProduct(product)}</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <Link href={mcpServerHref}>MCP server</Link>
        <ChevronRight size={14} aria-hidden="true" />
        <strong>Create MCP server</strong>
      </nav>

      <div className="page-head">
        <h1 className="page-title">Create MCP server</h1>
      </div>

      <div className="mcp-create-layout">
        <nav className="mcp-create-step-panel" aria-label="Registration steps">
          <ol className="mcp-create-steps">
            <li className="mcp-create-step active" aria-current="step">
              <button type="button">
                <span className="mcp-create-step-number">1</span>
                <span>Source</span>
              </button>
            </li>
            <li className="mcp-create-step">
              <button type="button" disabled>
                <span className="mcp-create-step-number">2</span>
                <span>Configuration</span>
              </button>
            </li>
            <li className="mcp-create-step">
              <button type="button" disabled>
                <span className="mcp-create-step-number">3</span>
                <span>Confirm</span>
              </button>
            </li>
          </ol>
        </nav>

        <form className="mcp-create-form">
          <fieldset className="mcp-create-fieldset">
            <legend>Creation method <span aria-label="required">*</span></legend>
            <div className="mcp-create-choice-list">
              <label className="mcp-create-choice disabled">
                <input name="creation-method" type="radio" value="mcp-template" disabled />
                <span>
                  <strong>MCP template</strong>
                  <small>Create an MCP server from an MCP template.</small>
                </span>
              </label>
              <label className="mcp-create-choice">
                <input name="creation-method" type="radio" value="direct-setup" defaultChecked />
                <span>
                  <strong>Direct setup</strong>
                  <small>Create an MCP server without a template. For development or testing purposes.</small>
                </span>
              </label>
              <label className="mcp-create-choice disabled">
                <input name="creation-method" type="radio" value="openapi-spec" disabled />
                <span>
                  <strong>OpenAPI spec</strong>
                  <small>Convert an existing REST API into MCP tools from an OpenAPI specification.</small>
                </span>
              </label>
            </div>
          </fieldset>

          <fieldset className="mcp-create-fieldset">
            <legend>Source <span aria-label="required">*</span></legend>
            <div className="mcp-create-choice-list">
              <label className="mcp-create-choice source-choice">
                <input name="source" type="radio" value="container-registry" defaultChecked />
                <span>
                  <strong>Container registry</strong>
                  <small>Specify the container image stored in your container registry.</small>
                </span>
              </label>
            </div>
          </fieldset>

          <ContainerImageField />

          <div className="mcp-create-field">
            <label htmlFor="mcp-port">Target port <span aria-label="required">*</span></label>
            <p>Enter the internal port on the container that receives traffic.</p>
            <input id="mcp-port" className="filter-select" name="port" type="number" min="1" max="65535" defaultValue="8080" required />
          </div>

          <fieldset className="mcp-create-fieldset">
            <legend>Protocol <span aria-label="required">*</span></legend>
            <div className="mcp-create-choice-list">
              <label className="mcp-create-choice">
                <input name="protocol" type="radio" value="streamable-http" defaultChecked />
                <span>
                  <strong>Streamable HTTP</strong>
                  <small>Stream data over standard HTTP with flexible formats such as JSON or logs.</small>
                </span>
              </label>
              <label className="mcp-create-choice disabled">
                <input name="protocol" type="radio" value="sse" disabled />
                <span>
                  <strong>SSE (Server-Sent Events)</strong>
                  <small>Receive real-time event streams over a browser-friendly, one-way connection.</small>
                </span>
              </label>
            </div>
          </fieldset>

          <details className="mcp-create-additional">
            <summary>Additional setting</summary>
            <div className="mcp-create-field">
              <label htmlFor="mcp-path">Path <span aria-label="required">*</span></label>
              <input id="mcp-path" className="filter-select" name="path" defaultValue="/mcp" required />
            </div>
            <div className="mcp-create-field">
              <label htmlFor="mcp-command">Container command</label>
              <p>Enter a command or leave blank to use the entry point set in the container image.</p>
              <input id="mcp-command" className="filter-select" name="command" placeholder="e.g. /bin/server" />
            </div>
            <div className="mcp-create-field">
              <label htmlFor="mcp-argument">Container argument</label>
              <input id="mcp-argument" className="filter-select" name="argument" placeholder="e.g. --port 8080" />
            </div>
          </details>

          <div className="mcp-create-actions">
            <Link className="button" href={mcpServerHref} style={{ textDecoration: "none" }}>Cancel</Link>
            <button className="button" type="button" disabled>Next</button>
          </div>
        </form>
      </div>
    </ConsoleTemplate>
  )
}
