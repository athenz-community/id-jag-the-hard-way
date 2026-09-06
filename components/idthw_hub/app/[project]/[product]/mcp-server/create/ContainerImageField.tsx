"use client"

import { useMcpCreateDraft } from "./McpCreateDraftContext"

export function ContainerImageField() {
  const { draft, setDraft } = useMcpCreateDraft()

  function setImage(image: string) {
    setDraft((currentDraft) => ({ ...currentDraft, image }))
  }

  return (
    <div className="mcp-create-field">
      <label htmlFor="mcp-image">Container image URL <span aria-label="required">*</span></label>
      <p>Enter a public container image URL, such as an image hosted on GHCR.</p>
      <input
        id="mcp-image"
        className="filter-select"
        name="image"
        placeholder="ghcr.io/example/mcp-server:latest"
        required
        value={draft.image}
        onChange={(event) => setImage(event.target.value)}
      />
    </div>
  )
}
