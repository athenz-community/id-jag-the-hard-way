import assert from "node:assert/strict"
import test from "node:test"
import { mcpServiceKeyId } from "../features/registration/lib/mcpServiceKeyId.ts"

test("uses a readable per-server Athenz service key ID", () => {
  assert.equal(mcpServiceKeyId("testapiserver"), "idthw-hub-testapiserver")
  assert.notEqual(mcpServiceKeyId("first-server"), mcpServiceKeyId("second-server"))
})

test("caps long service key IDs with a stable collision-resistant suffix", () => {
  const first = mcpServiceKeyId(`a${"b".repeat(61)}c`)
  const second = mcpServiceKeyId(`a${"b".repeat(61)}d`)
  assert.equal(first.length, 63)
  assert.equal(second.length, 63)
  assert.notEqual(first, second)
  assert.equal(first, mcpServiceKeyId(`a${"b".repeat(61)}c`))
})

test("rejects values outside the MCP Kubernetes key contract", () => {
  assert.throws(() => mcpServiceKeyId("Invalid_Name"), /invalid/)
})
