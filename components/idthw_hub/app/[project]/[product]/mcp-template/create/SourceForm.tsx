"use client"

import Link from "next/link"
import { ContainerArgumentsField } from "@/features/registration/components/ContainerArgumentsField"
import { useMcpTemplateDraft } from "./McpTemplateDraftContext"

const DEFAULT_MCP_IMAGES = [
  "ghcr.io/mlajkim/idthw-demo-api-mcp:latest",
  "ghcr.io/sooperset/mcp-atlassian:latest",
]

export function SourceForm({
  cancelHref,
  configurationHref,
}: {
  cancelHref: string
  configurationHref: string
}) {
  const { draft, setDraft, resetDraft } = useMcpTemplateDraft()

  function setImage(image: string) {
    setDraft((currentDraft) => ({ ...currentDraft, image }))
  }

  return (
    <form className="mcp-create-form" autoComplete="off">
      <fieldset className="mcp-create-fieldset">
        <legend>Source <span aria-label="required">*</span></legend>
        <div className="mcp-create-choice-list">
          <label className="mcp-create-choice source-choice">
            <input name="source" type="radio" value="container-registry" defaultChecked />
            <span>
              <strong>Container registry</strong>
              <small>Specify the container image used by MCP servers created from this template.</small>
            </span>
          </label>
        </div>
      </fieldset>

      <div className="mcp-create-field">
        <label htmlFor="template-image">Container image URL <span aria-label="required">*</span></label>
        <p>Enter a public container image URL, such as an image hosted on GHCR.</p>
        <input
          id="template-image"
          className="filter-select"
          name="image"
          placeholder="ghcr.io/example/mcp-server:latest"
          required
          value={draft.image}
          onChange={(event) => setImage(event.target.value)}
        />
        <div className="mcp-create-suggestions">
          <span>Suggestion</span>
          {DEFAULT_MCP_IMAGES.map((suggestedImage) => (
            <button
              className="button"
              type="button"
              disabled={draft.image === suggestedImage}
              onClick={() => setImage(suggestedImage)}
              key={suggestedImage}
            >
              {suggestedImage}
            </button>
          ))}
        </div>
      </div>

      <div className="mcp-create-field">
        <label htmlFor="template-port">Target port <span aria-label="required">*</span></label>
        <p>Enter the internal port on the container that receives MCP traffic.</p>
        <input
          id="template-port"
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
            <input name="transport" type="radio" value="streamable-http" defaultChecked />
            <span>
              <strong>Streamable HTTP</strong>
              <small>Expose the MCP server over standard HTTP.</small>
            </span>
          </label>
          <label className="mcp-create-choice disabled">
            <input name="transport" type="radio" value="sse" disabled />
            <span>
              <strong>SSE (Server-Sent Events)</strong>
              <small>Not available for new templates.</small>
            </span>
          </label>
        </div>
      </fieldset>

      <details className="mcp-create-additional">
        <summary>Additional setting</summary>
        <div className="mcp-create-field">
          <label htmlFor="template-path">Path <span aria-label="required">*</span></label>
          <input
            id="template-path"
            className="filter-select"
            name="path"
            required
            value={draft.path}
            onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, path: event.target.value }))}
          />
        </div>
        <div className="mcp-create-field">
          <label htmlFor="template-command">Container command</label>
          <p>Enter a command or leave blank to use the entry point set in the container image.</p>
          <input
            id="template-command"
            className="filter-select"
            name="command"
            placeholder="e.g. /bin/server"
            value={draft.command}
            onChange={(event) => setDraft((currentDraft) => ({ ...currentDraft, command: event.target.value }))}
          />
        </div>
        <ContainerArgumentsField
          idPrefix="template"
          containerArguments={draft.containerArguments}
          onChange={(containerArguments) => setDraft((currentDraft) => ({ ...currentDraft, containerArguments }))}
        />
      </details>

      <div className="mcp-create-actions">
        <Link className="button" href={cancelHref} style={{ textDecoration: "none" }} onClick={resetDraft}>Cancel</Link>
        <Link className="button mcp-create-primary" href={configurationHref}>Next</Link>
      </div>
    </form>
  )
}
