import assert from "node:assert/strict"
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
  const store = new UsageStore({ now: () => new Date("2026-07-20T12:00:00Z") })
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
    date: "2026-07-20",
    last_usage: "21:00:00",
    sub: "user.alice",
    client_id: "home.alice.local.athenzd",
    scope: "gen-ai.services.athenz:role.gen-ai-users",
    requests: 2,
    input_tokens: 9,
    output_tokens: 14,
    total_tokens: 23,
    tokens: [{
      model: "gemma4:26b",
      requests: 2,
      input: 9,
      output: 14,
      total: 23,
    }],
  }])
  assert.equal(store.list("gen-ai.services.spire")[0].sub, "user.bob")
  assert.deepEqual(store.listProjects().map(({ project, scope }) => ({ project, scope })), [
    { project: "athenz", scope: "gen-ai.services.athenz:role.gen-ai-users" },
    { project: "spire", scope: "gen-ai.services.spire:role.gen-ai-users" },
  ])
})

test("persists usage across store instances", () => {
  const directory = mkdtempSync(join(tmpdir(), "genai-proxy-usage-"))
  const dataPath = join(directory, "usage.json")

  try {
    const first = new UsageStore({ dataPath, now: () => new Date("2026-07-20T12:00:00Z") })
    first.record({
      project: "gen-ai.services.athenz",
      subject: "user.alice",
      clientId: "home.alice.local.athenzd",
      scope: "gen-ai.services.athenz:role.gen-ai-users",
    }, { promptTokens: 2, completionTokens: 3, totalTokens: 5 })

    const reloaded = new UsageStore({ dataPath })
    assert.deepEqual(reloaded.list("gen-ai.services.athenz"), [{
      date: "2026-07-20",
      last_usage: "21:00:00",
      sub: "user.alice",
      client_id: "home.alice.local.athenzd",
      scope: "gen-ai.services.athenz:role.gen-ai-users",
      requests: 1,
      input_tokens: 2,
      output_tokens: 3,
      total_tokens: 5,
      tokens: [{
        model: "gemma4:26b",
        requests: 1,
        input: 2,
        output: 3,
        total: 5,
      }],
    }])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("groups usage by JST date and lists the newest date first", () => {
  let now = new Date("2026-07-19T14:59:00Z")
  const store = new UsageStore({ now: () => now })
  const identity = {
    project: "gen-ai.services.athenz",
    subject: "user.alice",
    clientId: "home.alice.local.athenzd",
    scope: "gen-ai.services.athenz:role.gen-ai-users",
  }

  store.record(identity, { promptTokens: 1, completionTokens: 2, totalTokens: 3 })
  now = new Date("2026-07-19T15:01:00Z")
  store.record(identity, { promptTokens: 4, completionTokens: 5, totalTokens: 9 })

  assert.deepEqual(store.list("gen-ai.services.athenz").map(({ date, last_usage, total_tokens }) => ({ date, last_usage, total_tokens })), [
    { date: "2026-07-20", last_usage: "00:01:00", total_tokens: 9 },
    { date: "2026-07-19", last_usage: "23:59:00", total_tokens: 3 },
  ])
})

test("loads version 1 data using the file modification date", () => {
  const directory = mkdtempSync(join(tmpdir(), "genai-proxy-usage-v1-"))
  const dataPath = join(directory, "usage.json")

  try {
    writeFileSync(dataPath, JSON.stringify({
      version: 1,
      projects: [{
        project: "gen-ai.services.athenz",
        users: [{
          subject: "user.alice",
          clientId: "home.alice.local.athenzd",
          scope: "gen-ai.services.athenz:role.gen-ai-users",
          requests: 1,
          promptTokens: 2,
          completionTokens: 3,
          totalTokens: 5,
        }],
      }],
    }))
    const modified = new Date("2026-07-18T12:00:00Z")
    utimesSync(dataPath, modified, modified)

    const migrated = new UsageStore({ dataPath })
    assert.equal(migrated.list("gen-ai.services.athenz")[0].date, "2026-07-18")
    assert.equal(migrated.list("gen-ai.services.athenz")[0].last_usage, "21:00:00")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("loads version 2 daily data with a JST last-usage time", () => {
  const directory = mkdtempSync(join(tmpdir(), "genai-proxy-usage-v2-"))
  const dataPath = join(directory, "usage.json")

  try {
    writeFileSync(dataPath, JSON.stringify({
      version: 2,
      projects: [{
        project: "gen-ai.services.athenz",
        users: [{
          date: "2026-07-17",
          subject: "user.alice",
          clientId: "home.alice.local.athenzd",
          scope: "gen-ai.services.athenz:role.gen-ai-users",
          requests: 1,
          promptTokens: 2,
          completionTokens: 3,
          totalTokens: 5,
        }],
      }],
    }))
    const modified = new Date("2026-07-18T12:00:00Z")
    utimesSync(dataPath, modified, modified)

    const migrated = new UsageStore({ dataPath })
    assert.equal(migrated.list("gen-ai.services.athenz")[0].last_usage, "00:00:00")
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test("tracks multiple models independently within a daily user entry", () => {
  const store = new UsageStore({ now: () => new Date("2026-07-20T12:00:00Z") })
  const identity = {
    project: "gen-ai.services.athenz",
    subject: "user.alice",
    clientId: "home.alice.local.athenzd",
    scope: "gen-ai.services.athenz:role.gen-ai-users",
  }

  store.record({ ...identity, model: "gemma4:26b" }, { promptTokens: 2, completionTokens: 3, totalTokens: 5 })
  store.record({ ...identity, model: "gemma4:31b" }, { promptTokens: 7, completionTokens: 11, totalTokens: 18 })

  assert.deepEqual(store.list("gen-ai.services.athenz")[0].tokens, [
    { model: "gemma4:26b", requests: 1, input: 2, output: 3, total: 5 },
    { model: "gemma4:31b", requests: 1, input: 7, output: 11, total: 18 },
  ])
})

test("aggregates current daily model usage across users for service-code limits", () => {
  const store = new UsageStore({ now: () => new Date("2026-07-20T12:00:00Z") })
  for (const [subject, promptTokens, completionTokens] of [
    ["user.alice", 2, 3],
    ["user.bob", 5, 7],
  ] as const) {
    store.record({
      project: "gen-ai.services.athenz",
      subject,
      clientId: `home.${subject.slice("user.".length)}.local.athenzd`,
      model: "gemma4:26b",
      scope: "gen-ai.services.athenz:role.gen-ai-users",
    }, { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens })
  }

  assert.deepEqual(store.currentDailyModels("gen-ai.services.athenz"), [{
    model: "gemma4:26b",
    requests: 2,
    promptTokens: 7,
    completionTokens: 10,
    totalTokens: 17,
  }])
})
