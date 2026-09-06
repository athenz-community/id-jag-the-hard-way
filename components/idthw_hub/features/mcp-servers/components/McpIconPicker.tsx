"use client"

import Image from "next/image"
import type { McpIconOption } from "../lib/mcpIcons"

export function McpIconPicker({
  iconOptions,
  name,
  onChange,
  resourceKind,
  value,
}: {
  iconOptions: McpIconOption[]
  name: string
  onChange: (iconId: string) => void
  resourceKind: "MCP server" | "MCP template"
  value: string
}) {
  const selectedIconMissing = Boolean(
    value && !iconOptions.some((option) => option.id === value),
  )

  return (
    <fieldset className="mcp-create-fieldset">
      <legend>Icon</legend>
      <p className="mcp-create-field-copy">
        Select an icon. If its image file is unavailable, the list uses the {resourceKind.toLowerCase()} name initials.
      </p>
      <div className="mcp-icon-choice-list">
        <label className="mcp-icon-choice" aria-label="Use name initials" title="Name initials">
          <input
            className="sr-only"
            name={`${resourceKind}-icon`}
            type="radio"
            value=""
            checked={!value}
            onChange={() => onChange("")}
          />
          <McpIconPreview iconOptions={iconOptions} name={name} value="" decorative />
        </label>
        {iconOptions.map((option) => (
          <label
            className="mcp-icon-choice"
            key={option.id}
            aria-label={`Use ${option.label} icon`}
            title={option.label}
          >
            <input
              className="sr-only"
              name={`${resourceKind}-icon`}
              type="radio"
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
            />
            <McpIconPreview iconOptions={iconOptions} name={name} value={option.id} decorative />
          </label>
        ))}
      </div>
      {selectedIconMissing ? (
        <p className="mcp-create-field-warning" role="status">
          The saved icon is unavailable. The list will use name initials unless you select another icon.
        </p>
      ) : null}
    </fieldset>
  )
}

export function McpIconPreview({
  decorative = false,
  iconOptions,
  name,
  value,
}: {
  decorative?: boolean
  iconOptions: McpIconOption[]
  name: string
  value: string
}) {
  const selectedIcon = iconOptions.find((option) => option.id === value)
  const description = selectedIcon ? `${selectedIcon.label} icon` : `${resourceInitials(name)} initials`

  return (
    <>
      <span className={`mcp-icon-preview ${selectedIcon ? "" : "mcp-icon-initials"}`} aria-hidden="true">
        {selectedIcon
          ? <Image src={selectedIcon.src} alt="" width={36} height={36} />
          : resourceInitials(name)}
      </span>
      {decorative ? null : <span className="sr-only">{description}</span>}
    </>
  )
}

function resourceInitials(name: string) {
  return name
    .split(/[-_\s]+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "M"
}
