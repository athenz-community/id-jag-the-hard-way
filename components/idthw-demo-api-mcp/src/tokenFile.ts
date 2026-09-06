import { readFile } from "node:fs/promises"
import { isAbsolute, relative, resolve, sep } from "node:path"

export const MCP_ACCESS_TOKEN_FILE_META_KEY = "mcp.idthw.dev/access-token-file"

const MAX_ACCESS_TOKEN_BYTES = 32 * 1024
const REQUEST_TOKEN_FILE_PATTERN = /^[a-f0-9-]{36}\.jwt$/

export async function readDelegatedAccessToken(
  meta: unknown,
  toolName: string,
  tokenDirectory: string,
) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    throw new Error("This tool call requires delegated access-token metadata from MCP Runtime Proxy.")
  }
  const configuredPath = (meta as Record<string, unknown>)[MCP_ACCESS_TOKEN_FILE_META_KEY]
  if (typeof configuredPath !== "string" || !configuredPath) {
    throw new Error("This tool call has no delegated access-token file.")
  }

  const root = resolve(tokenDirectory)
  const candidate = resolve(configuredPath)
  const pathBelowRoot = relative(root, candidate)
  if (
    !isAbsolute(configuredPath)
    || !pathBelowRoot
    || pathBelowRoot.startsWith(`..${sep}`)
    || pathBelowRoot === ".."
    || isAbsolute(pathBelowRoot)
  ) {
    throw new Error("The delegated access-token file path is outside the configured directory.")
  }
  const pathParts = pathBelowRoot.split(sep)
  if (
    pathParts.length !== 2
    || pathParts[0] !== toolName
    || !REQUEST_TOKEN_FILE_PATTERN.test(pathParts[1])
  ) {
    throw new Error("The delegated access-token file does not match this tool call.")
  }

  const token = (await readFile(candidate, { encoding: "utf8" })).trim()
  if (
    !token
    || Buffer.byteLength(token) > MAX_ACCESS_TOKEN_BYTES
    || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
  ) {
    throw new Error("The delegated access-token file is invalid.")
  }
  return token
}
