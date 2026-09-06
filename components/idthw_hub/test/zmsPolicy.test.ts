import assert from "node:assert/strict"
import test from "node:test"
import {
  parseZmsPolicy,
  parseZmsPolicyList,
  policyAssertionKey,
} from "../features/permissions/lib/zmsPolicy.ts"

test("parses ZMS policy names and inline assertions", () => {
  assert.deepEqual(parseZmsPolicyList(JSON.stringify({
    names: ["api:policy.getter"],
    policies: [{
      name: "api:policy.exchanger",
      assertions: [{
        action: "zts.token_target_exchange",
        resource: "api:mcp-hub.mcps.docs:role.getter",
        role: "api:role.getter-exchanger",
      }],
    }],
  })), {
    assertions: [{
      action: "zts.token_target_exchange",
      effect: "ALLOW",
      resource: "api:mcp-hub.mcps.docs:role.getter",
      role: "api:role.getter-exchanger",
    }],
    names: ["api:policy.getter", "api:policy.exchanger"],
  })
})

test("keeps policy effect in the exact assertion identity", () => {
  const [assertion] = parseZmsPolicy(JSON.stringify({
    assertions: [{
      action: "zts.jag_exchange",
      effect: "DENY",
      resource: "api:role.getter",
      role: "api:role.getter-jag-exchanger",
    }],
  }))
  assert.equal(
    policyAssertionKey(assertion),
    "DENY\nzts.jag_exchange\napi:role.getter-jag-exchanger\napi:role.getter",
  )
})
