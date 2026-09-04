"use client"

import { useState } from "react"

const DEFAULT_MCP_IMAGES = [
  "ghcr.io/mlajkim/mcp:latest",
  "ghcr.io/sooperset/mcp-atlassian:latest",
]

export function ContainerImageField() {
  const [image, setImage] = useState("")

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
        value={image}
        onChange={(event) => setImage(event.target.value)}
      />
      <div className="mcp-create-suggestions">
        <span>Suggestion</span>
        {DEFAULT_MCP_IMAGES.map((suggestedImage) => (
          <button
            className="button"
            type="button"
            disabled={image === suggestedImage}
            onClick={() => setImage(suggestedImage)}
            key={suggestedImage}
          >
            {suggestedImage}
          </button>
        ))}
      </div>
    </div>
  )
}
