import assert from "node:assert/strict"
import { test } from "node:test"
import { estimatedTokenCostUsd } from "../src/billing.ts"

test("uses OpenAI standard pricing for GPT-5.6 models", () => {
  assert.equal(estimatedTokenCostUsd("gpt-5.6-sol", 1_000_000, 1_000_000), 35)
  assert.equal(estimatedTokenCostUsd("gpt-5.6-terra", 1_000_000, 1_000_000), 17.5)
  assert.equal(estimatedTokenCostUsd("gpt-5.6-luna", 1_000_000, 1_000_000), 7)
})

test("uses the fallback price for an unregistered model", () => {
  assert.equal(estimatedTokenCostUsd("unregistered-model", 1_000_000, 1_000_000), 0.4)
})
