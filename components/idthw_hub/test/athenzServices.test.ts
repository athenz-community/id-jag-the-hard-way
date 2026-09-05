import assert from "node:assert/strict"
import test from "node:test"
import { athenzServiceName, parseAthenzServiceList } from "../features/registration/lib/athenzServices.ts"

const domain = "mcp-hub.mcps.k8s-docs-server"

test("qualifies, sorts, and deduplicates ZMS service names", () => {
  assert.deepEqual(parseAthenzServiceList({
    names: [
      "runtime-proxy",
      "api-mcp",
      "runtime-proxy",
    ],
  }, domain), [
    `${domain}.api-mcp`,
    `${domain}.runtime-proxy`,
  ])
})

test("accepts already-qualified names and rejects malformed service lists", () => {
  assert.deepEqual(parseAthenzServiceList({ names: [`${domain}.api-mcp`] }, domain), [
    `${domain}.api-mcp`,
  ])
  assert.throws(() => parseAthenzServiceList({}, domain), /invalid service list/)
  assert.throws(() => parseAthenzServiceList({ names: [""] }, domain), /invalid service name/)
})

test("shows only the service name from a qualified principal", () => {
  assert.equal(athenzServiceName(`${domain}.api-mcp`), "api-mcp")
  assert.equal(athenzServiceName("api-mcp"), "api-mcp")
})
