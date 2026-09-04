"use client"

import Link from "next/link"
import { ContainerImageField } from "./ContainerImageField"
import { useMcpCreateDraft } from "./McpCreateDraftContext"

export function SourceForm({
  cancelHref,
  configurationHref,
}: {
  cancelHref: string
  configurationHref: string
}) {
  const { draft, setDraft, resetDraft } = useMcpCreateDraft()

  return (
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
        <input
          id="mcp-port"
          className="filter-select"
          name="port"
          type="number"
          min="1"
          max="65535"
          required
          value={draft.port}
          onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, port: event.target.value }))}
        />
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
          <input
            id="mcp-path"
            className="filter-select"
            name="path"
            required
            value={draft.path}
            onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, path: event.target.value }))}
          />
        </div>
        <div className="mcp-create-field">
          <label htmlFor="mcp-command">Container command</label>
          <p>Enter a command or leave blank to use the entry point set in the container image.</p>
          <input
            id="mcp-command"
            className="filter-select"
            name="command"
            placeholder="e.g. /bin/server"
            value={draft.command}
            onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, command: event.target.value }))}
          />
        </div>
        <div className="mcp-create-field">
          <label htmlFor="mcp-argument">Container argument</label>
          <input
            id="mcp-argument"
            className="filter-select"
            name="argument"
            placeholder="e.g. --port 8080"
            value={draft.argument}
            onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, argument: event.target.value }))}
          />
        </div>
      </details>

      <div className="mcp-create-actions">
        <Link className="button" href={cancelHref} style={{ textDecoration: "none" }} onClick={resetDraft}>Cancel</Link>
        <Link className="button mcp-create-primary" href={configurationHref}>Next</Link>
      </div>
    </form>
  )
}
