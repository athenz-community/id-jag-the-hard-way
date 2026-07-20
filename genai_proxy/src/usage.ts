export type TokenUsage = {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

type UserUsage = TokenUsage & {
  clientId: string
  requests: number
  scope: string
  subject: string
}

export type UsageIdentity = {
  clientId: string
  project: string
  scope: string
  subject: string
}

export class UsageStore {
  private readonly projects = new Map<string, Map<string, UserUsage>>()

  record(identity: UsageIdentity, usage: TokenUsage) {
    const users = this.projects.get(identity.project) ?? new Map<string, UserUsage>()
    const key = [identity.subject, identity.clientId, identity.scope].join("\u0000")
    const current = users.get(key) ?? {
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
    users.set(key, current)
    this.projects.set(identity.project, users)
  }

  list(project: string) {
    return [...(this.projects.get(project)?.values() ?? [])]
      .sort((left, right) => left.subject.localeCompare(right.subject) || left.clientId.localeCompare(right.clientId))
      .map((usage) => ({
        sub: usage.subject,
        client_id: usage.clientId,
        scope: usage.scope,
        requests: usage.requests,
        input_tokens: usage.promptTokens,
        output_tokens: usage.completionTokens,
        total_tokens: usage.totalTokens,
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
