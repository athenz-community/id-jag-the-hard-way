import { readdir } from "node:fs/promises"
import path from "node:path"

const MCP_ICON_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}\.(?:avif|gif|jpe?g|png|webp)$/i

export type McpIconOption = {
  id: string
  label: string
  src: string
}

export async function listMcpIconOptions(): Promise<McpIconOption[]> {
  try {
    const entries = await readdir(path.join(process.cwd(), "public", "mcp_icons"), {
      withFileTypes: true,
    })
    return mcpIconOptionsFromFileNames(
      entries.filter((entry) => entry.isFile()).map((entry) => entry.name),
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }
}

export function mcpIconOptionsFromFileNames(fileNames: string[]): McpIconOption[] {
  return [...new Set(fileNames.filter(isValidMcpIconId))]
    .sort((left, right) => left.localeCompare(right))
    .map((id) => ({
      id,
      label: iconLabel(id),
      src: `/mcp_icons/${encodeURIComponent(id)}`,
    }))
}

export function isValidMcpIconId(value: string) {
  return MCP_ICON_ID_PATTERN.test(value)
}

export function normalizeMcpIconId(value: string | undefined) {
  const configured = value?.trim() ?? ""
  if (isValidMcpIconId(configured)) return configured

  const legacyMatch = /^\/(?:icons|mcp_icons)\/([^/]+)$/.exec(configured)
  if (!legacyMatch) return ""
  try {
    const fileName = decodeURIComponent(legacyMatch[1])
    return isValidMcpIconId(fileName) ? fileName : ""
  } catch {
    return ""
  }
}

export function resolveMcpIconSrc(
  configuredId: string | undefined,
  options: McpIconOption[],
) {
  const iconId = normalizeMcpIconId(configuredId)
  return options.find((option) => option.id === iconId)?.src
}

function iconLabel(id: string) {
  const name = id.replace(/\.[^.]+$/, "")
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}
