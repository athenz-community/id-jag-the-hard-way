export type ModelTokenUsage = {
  model: string
  requests: number
  input: number
  output: number
  total: number
  estimated_cost_usd?: number
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
  estimated_cost_usd?: number
  tokens?: ModelTokenUsage[]
}

export type ProjectUsage = {
  project: string
  scope?: string
  daily_limit_usd?: number | null
  daily_limit_fraction_digits?: number | null
  daily_spend_usd?: number
  users: UserUsage[]
}

export type GenAIUsageResponse = {
  projects: ProjectUsage[]
  error?: string
}
