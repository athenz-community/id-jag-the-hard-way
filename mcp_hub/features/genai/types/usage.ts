export type ModelTokenUsage = {
  model: string
  requests: number
  input: number
  output: number
  total: number
}

export type UserUsage = {
  date: string
  last_usage: string
  sub: string
  client_id: string
  scope: string
  requests: number
  input_tokens: number
  output_tokens: number
  total_tokens: number
  tokens?: ModelTokenUsage[]
}

export type ProjectUsage = {
  project: string
  scope?: string
  users: UserUsage[]
}

export type GenAIUsageResponse = {
  projects: ProjectUsage[]
  error?: string
}
