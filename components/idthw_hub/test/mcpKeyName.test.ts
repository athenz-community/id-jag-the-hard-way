import assert from "node:assert/strict"
import test from "node:test"
import { normalizeMcpKeyName } from "../features/mcp-servers/lib/mcpKeyName.ts"

test("normalizes MCP key names to lowercase with hyphens for whitespace", () => {
  assert.equal(normalizeMcpKeyName("My MCP Server"), "my-mcp-server")
  assert.equal(normalizeMcpKeyName("K8S  Docs\tServer"), "k8s-docs-server")
})
