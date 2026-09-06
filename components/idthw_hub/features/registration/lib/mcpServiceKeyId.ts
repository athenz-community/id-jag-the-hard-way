import { createHash } from "node:crypto"

const KEY_ID_PREFIX = "idthw-hub-"
const MAX_KEY_ID_LENGTH = 63
const MCP_KEY_PATTERN = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/

export function mcpServiceKeyId(mcpKeyName: string) {
  if (!MCP_KEY_PATTERN.test(mcpKeyName)) throw new Error("MCP key name is invalid for a service key")
  const readable = `${KEY_ID_PREFIX}${mcpKeyName}`
  if (readable.length <= MAX_KEY_ID_LENGTH) return readable

  const suffix = createHash("sha256").update(mcpKeyName).digest("hex").slice(0, 12)
  const availableNameLength = MAX_KEY_ID_LENGTH - KEY_ID_PREFIX.length - suffix.length - 1
  return `${KEY_ID_PREFIX}${mcpKeyName.slice(0, availableNameLength)}-${suffix}`
}
