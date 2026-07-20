import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export type TokenUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

type ModelUsage = TokenUsage & {
  model: string
  requests: number
}

type UserUsage = TokenUsage & {
  clientId: string
  date: string
  lastUsage: string
  models: ModelUsage[]
  requests: number
  scope: string
  subject: string
}

export type UsageIdentity = {
  clientId: string
  model?: string
  project: string
  scope: string
  subject: string
}

type UsageStoreOptions = {
  dataPath?: string
  now?: () => Date
}

type UsageSnapshot = {
  version: 4
  projects: Array<{
    project: string
    users: UserUsage[]
  }>
}

export const DEFAULT_MODEL = "gemma4:26b"

export class UsageStore {
  private readonly projects = new Map<string, Map<string, UserUsage>>()
  private readonly dataPath?: string
  private readonly now: () => Date

  constructor(options: UsageStoreOptions = {}) {
    this.dataPath = options.dataPath
    this.now = options.now ?? (() => new Date())
    if (this.dataPath) this.load()
  }

  record(identity: UsageIdentity, usage: TokenUsage) {
    const users = this.projects.get(identity.project) ?? new Map<string, UserUsage>()
    const recordedAt = this.now()
    const date = jstDate(recordedAt)
    const lastUsage = jstTimestamp(recordedAt)
    const key = [date, identity.subject, identity.clientId, identity.scope].join("\u0000")
    const current = users.get(key) ?? {
      date,
      lastUsage,
      models: [],
      subject: identity.subject,
      clientId: identity.clientId,
      scope: identity.scope,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }
    current.requests += 1
    current.promptTokens += usage.promptTokens
    current.completionTokens += usage.completionTokens
    current.totalTokens += usage.totalTokens
    current.lastUsage = lastUsage
    const modelName = identity.model?.trim() || DEFAULT_MODEL
    const model = current.models.find((item) => item.model === modelName) ?? {
      model: modelName,
      requests: 0,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    }
    model.requests += 1
    model.promptTokens += usage.promptTokens
    model.completionTokens += usage.completionTokens
    model.totalTokens += usage.totalTokens
    if (!current.models.includes(model)) current.models.push(model)
    users.set(key, current)
    this.projects.set(identity.project, users)
    this.persist()
  }

  list(project: string) {
    return [...(this.projects.get(project)?.values() ?? [])]
      .sort((left, right) => right.date.localeCompare(left.date)
        || right.lastUsage.localeCompare(left.lastUsage)
        || left.subject.localeCompare(right.subject)
        || left.clientId.localeCompare(right.clientId))
      .map((usage) => ({
        date: usage.date,
        last_usage: usage.lastUsage.slice(11, 19),
        sub: usage.subject,
        client_id: usage.clientId,
        scope: usage.scope,
        requests: usage.requests,
        input_tokens: usage.promptTokens,
        output_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
        tokens: usage.models
          .slice()
          .sort((left, right) => left.model.localeCompare(right.model))
          .map((model) => ({
            model: model.model,
            requests: model.requests,
            input: model.promptTokens,
            output: model.completionTokens,
            total: model.totalTokens,
          })),
      }))
  }

  listProjects() {
    return [...this.projects.keys()]
      .sort()
      .map((domain) => {
        const users = this.list(domain)
        return {
          project: domain.startsWith("gen-ai.services.")
            ? domain.slice("gen-ai.services.".length)
            : domain,
          scope: users[0]?.scope,
          users,
        }
      })
  }

  private load() {
    let encoded: string
    let modifiedAt: Date
    try {
      encoded = readFileSync(this.dataPath!, "utf8")
      modifiedAt = statSync(this.dataPath!).mtime
    } catch (error) {
      if (isErrorCode(error, "ENOENT")) return
      throw new Error(`Unable to read GenAI usage data from ${this.dataPath}: ${errorMessage(error)}`)
    }

    let snapshot: UsageSnapshot
    try {
      snapshot = parseSnapshot(JSON.parse(encoded), modifiedAt)
    } catch (error) {
      throw new Error(`Unable to parse GenAI usage data from ${this.dataPath}: ${errorMessage(error)}`)
    }

    for (const { project, users } of snapshot.projects) {
      const projectUsers = new Map<string, UserUsage>()
      for (const usage of users) {
        const key = [usage.date, usage.subject, usage.clientId, usage.scope].join("\u0000")
        projectUsers.set(key, usage)
      }
      this.projects.set(project, projectUsers)
    }
  }

  private persist() {
    if (!this.dataPath) return

    const directory = dirname(this.dataPath)
    const temporaryPath = `${this.dataPath}.${process.pid}.tmp`
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    writeFileSync(temporaryPath, `${JSON.stringify(this.snapshot(), null, 2)}\n`, { mode: 0o600 })
    renameSync(temporaryPath, this.dataPath)
  }

  private snapshot(): UsageSnapshot {
    return {
      version: 4,
      projects: [...this.projects.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([project, users]) => ({
          project,
          users: [...users.values()]
            .sort((left, right) => right.date.localeCompare(left.date)
              || right.lastUsage.localeCompare(left.lastUsage)
              || left.subject.localeCompare(right.subject)
              || left.clientId.localeCompare(right.clientId)
              || left.scope.localeCompare(right.scope)),
        })),
    }
  }
}

function parseSnapshot(value: unknown, modifiedAt: Date): UsageSnapshot {
  if (!isRecord(value) || ![1, 2, 3, 4].includes(value.version as number) || !Array.isArray(value.projects)) {
    throw new Error("expected a version 1, 2, 3, or 4 usage snapshot")
  }

  const version = value.version as 1 | 2 | 3 | 4
  const legacyDate = jstDate(modifiedAt)
  const projects = value.projects.map((entry) => {
    if (!isRecord(entry) || !Array.isArray(entry.users)) throw new Error("invalid project entry")
    return {
      project: requiredString(entry.project, "project"),
      users: entry.users.map((usage) => parseUserUsage(usage, { version, legacyDate, modifiedAt })),
    }
  })

  if (new Set(projects.map(({ project }) => project)).size !== projects.length) {
    throw new Error("duplicate project entry")
  }

  return { version: 4, projects }
}

function parseUserUsage(
  value: unknown,
  migration: { version: 1 | 2 | 3 | 4; legacyDate: string; modifiedAt: Date },
): UserUsage {
  if (!isRecord(value)) throw new Error("invalid user usage entry")
  const date = requiredUsageDate(value.date ?? (migration.version === 1 ? migration.legacyDate : undefined))
  const requests = requiredNonNegativeInteger(value.requests, "requests")
  const promptTokens = requiredNonNegativeInteger(value.promptTokens, "promptTokens")
  const completionTokens = requiredNonNegativeInteger(value.completionTokens, "completionTokens")
  const totalTokens = requiredNonNegativeInteger(value.totalTokens, "totalTokens")
  return {
    date,
    lastUsage: migration.version >= 3
      ? requiredJstTimestamp(value.lastUsage, date)
      : migratedLastUsage(date, migration.modifiedAt),
    models: migration.version === 4
      ? parseModelUsageList(value.models)
      : [{ model: DEFAULT_MODEL, requests, promptTokens, completionTokens, totalTokens }],
    subject: requiredString(value.subject, "subject"),
    clientId: requiredString(value.clientId, "clientId"),
    scope: requiredString(value.scope, "scope"),
    requests,
    promptTokens,
    completionTokens,
    totalTokens,
  }
}

function parseModelUsageList(value: unknown): ModelUsage[] {
  if (!Array.isArray(value)) throw new Error("models must be an array")
  const models = value.map((entry) => {
    if (!isRecord(entry)) throw new Error("invalid model usage entry")
    return {
      model: requiredString(entry.model, "model"),
      requests: requiredNonNegativeInteger(entry.requests, "model requests"),
      promptTokens: requiredNonNegativeInteger(entry.promptTokens, "model promptTokens"),
      completionTokens: requiredNonNegativeInteger(entry.completionTokens, "model completionTokens"),
      totalTokens: requiredNonNegativeInteger(entry.totalTokens, "model totalTokens"),
    }
  })
  if (new Set(models.map(({ model }) => model)).size !== models.length) throw new Error("duplicate model usage entry")
  return models
}

function jstDate(value: Date) {
  return new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function jstTimestamp(value: Date) {
  return new Date(value.getTime() + 9 * 60 * 60 * 1000).toISOString().replace("Z", "+09:00")
}

function migratedLastUsage(date: string, modifiedAt: Date) {
  const timestamp = jstTimestamp(modifiedAt)
  return timestamp.startsWith(`${date}T`) ? timestamp : `${date}T00:00:00.000+09:00`
}

function requiredUsageDate(value: unknown) {
  const date = requiredString(value, "date")
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("date must use YYYY-MM-DD format")
  }
  return date
}

function requiredJstTimestamp(value: unknown, date: string) {
  const timestamp = requiredString(value, "lastUsage")
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+09:00$/.test(timestamp)) {
    throw new Error("lastUsage must be an ISO timestamp with a +09:00 offset")
  }
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.valueOf()) || jstDate(parsed) !== date) {
    throw new Error("lastUsage must fall on the entry date in JST")
  }
  return timestamp
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${field} must be a non-empty string`)
  return value
}

function requiredNonNegativeInteger(value: unknown, field: string) {
  const number = nonNegativeInteger(value)
  if (number === undefined) throw new Error(`${field} must be a non-negative integer`)
  return number
}

function isErrorCode(error: unknown, code: string) {
  return isRecord(error) && error.code === code
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

export function extractTokenUsage(responseTail: string): TokenUsage | undefined {
  const objects = responseTail
    .split("\n")
    .map((line) => line.trim().replace(/^data:\s*/, ""))
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .reverse()

  for (const encoded of objects) {
    try {
      const value = JSON.parse(encoded) as Record<string, unknown>
      const usage = usageFromObject(value)
      if (usage) return usage
    } catch {
      // A partial first line is expected when only the response tail is retained.
    }
  }

  const promptTokens = lastInteger(responseTail, /"(?:prompt_eval_count|prompt_tokens)"\s*:\s*(\d+)/g)
  const completionTokens = lastInteger(responseTail, /"(?:eval_count|completion_tokens)"\s*:\s*(\d+)/g)
  const totalTokens = lastInteger(responseTail, /"total_tokens"\s*:\s*(\d+)/g)
  return normalizedUsage(promptTokens, completionTokens, totalTokens)
}

function usageFromObject(value: Record<string, unknown>) {
  const openAIUsage = value.usage
  if (openAIUsage && typeof openAIUsage === "object" && !Array.isArray(openAIUsage)) {
    const usage = openAIUsage as Record<string, unknown>
    return normalizedUsage(usage.prompt_tokens, usage.completion_tokens, usage.total_tokens)
  }
  return normalizedUsage(value.prompt_eval_count, value.eval_count, undefined)
}

function normalizedUsage(promptValue: unknown, completionValue: unknown, totalValue: unknown) {
  const promptTokens = nonNegativeInteger(promptValue)
  const completionTokens = nonNegativeInteger(completionValue)
  const explicitTotal = nonNegativeInteger(totalValue)
  if (promptTokens === undefined && completionTokens === undefined && explicitTotal === undefined) return undefined
  const prompt = promptTokens ?? 0
  const completion = completionTokens ?? 0
  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: explicitTotal ?? prompt + completion,
  }
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined
}

function lastInteger(value: string, expression: RegExp) {
  let last: number | undefined
  for (const match of value.matchAll(expression)) last = Number(match[1])
  return last
}
