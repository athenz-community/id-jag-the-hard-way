import assert from "node:assert/strict"
import { test } from "node:test"
import { extractTokenUsage, UsageStore } from "../src/usage.ts"

test("extracts native streaming Ollama usage", () => {
  assert.deepEqual(extractTokenUsage([
    '{"message":{"content":"hello"},"done":false}',
    '{"done":true,"prompt_eval_count":7,"eval_count":11}',
    "",
  ].join("\n")), { promptTokens: 7, completionTokens: 11, totalTokens: 18 })
})

test("extracts OpenAI-compatible usage", () => {
  assert.deepEqual(extractTokenUsage(
    'data: {"usage":{"prompt_tokens":2,"completion_tokens":4,"total_tokens":6}}\n\ndata: [DONE]\n',
  ), { promptTokens: 2, completionTokens: 4, totalTokens: 6 })
})

test("aggregates users separately within each project", () => {
  const store = new UsageStore()
  const alice = {
    project: "gen-ai.services.athenz",
    subject: "user.alice",
    clientId: "home.alice.local.athenzd",
    scope: "gen-ai.services.athenz:role.gen-ai-users",
  }
  store.record(alice, { promptTokens: 2, completionTokens: 3, totalTokens: 5 })
  store.record(alice, { promptTokens: 7, completionTokens: 11, totalTokens: 18 })
  store.record({
    project: "gen-ai.services.spire",
    subject: "user.bob",
    clientId: "home.bob.local.athenzd",
    scope: "gen-ai.services.spire:role.gen-ai-users",
  }, { promptTokens: 1, completionTokens: 1, totalTokens: 2 })

  assert.deepEqual(store.list("gen-ai.services.athenz"), [{
    sub: "user.alice",
    client_id: "home.alice.local.athenzd",
    scope: "gen-ai.services.athenz:role.gen-ai-users",
    requests: 2,
    input_tokens: 9,
    output_tokens: 14,
    total_tokens: 23,
  }])
  assert.equal(store.list("gen-ai.services.spire")[0].sub, "user.bob")
  assert.deepEqual(store.listProjects().map(({ project, scope }) => ({ project, scope })), [
    { project: "athenz", scope: "gen-ai.services.athenz:role.gen-ai-users" },
    { project: "spire", scope: "gen-ai.services.spire:role.gen-ai-users" },
  ])
})
