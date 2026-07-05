import { ChevronDown, Filter, Search } from "lucide-react"
import type { McpTool, McpToolInputSchema, McpToolSchemaProperty } from "@/features/catalog/types/tools"

export function ToolsFilter() {
  return (
    <div className="filter-row tools-filter-row">
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

export function ToolsLoadStatus({ endpoint, error }: { endpoint: string; error?: string }) {
  if (!error) return null

  return (
    <p className="catalog-error" role="status">
      MCP tools could not be loaded from {endpoint}: {error}
    </p>
  )
}

export function ToolsList({ tools }: { tools: McpTool[] }) {
  if (tools.length === 0) {
    return <div className="tools-empty">No tools returned by this MCP server.</div>
  }

  return (
    <div className="tools-list">
      {tools.map((tool, index) => (
        <ToolCard key={tool.name} tool={tool} defaultOpen={index === 0} />
      ))}
    </div>
  )
}

function ToolCard({ tool, defaultOpen }: { tool: McpTool; defaultOpen: boolean }) {
  const parameters = schemaParameters(tool.inputSchema)

  return (
    <details className="tool-card" open={defaultOpen}>
      <summary className="tool-card-summary">
        <span>{tool.name}</span>
        <ChevronDown className="tool-card-chevron" size={18} aria-hidden="true" />
      </summary>

      <div className="tool-card-body">
        <div className="tool-description-block">
          <h3>Description</h3>
          {tool.title && <p className="tool-title">{tool.title}</p>}
          <p>{tool.description ?? "No description provided."}</p>
        </div>

        <div className="tool-parameters-block">
          <h3>Parameters</h3>
          {parameters.length > 0 ? (
            <table className="tool-parameters-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Description</th>
                </tr>
              </thead>
              <tbody>
                {parameters.map((parameter) => (
                  <tr key={parameter.name}>
                    <td>
                      <span className="parameter-name">{parameter.name}</span>
                      {parameter.required && <span className="required-badge">Required</span>}
                    </td>
                    <td>{parameter.type}</td>
                    <td>{parameter.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="tool-empty-parameters">No parameters.</p>
          )}
        </div>
      </div>
    </details>
  )
}

function schemaParameters(schema?: McpToolInputSchema) {
  const properties = schema?.properties ?? {}
  const required = new Set(schema?.required ?? [])

  return Object.entries(properties).map(([name, property]) => ({
    name,
    required: required.has(name),
    type: schemaType(property),
    description: property.description ?? "No description provided.",
  }))
}

function schemaType(property: McpToolSchemaProperty) {
  if (Array.isArray(property.type)) return property.type.join(" | ")
  return property.type ?? "unknown"
}
