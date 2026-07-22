import type { ModelUsage } from "./usage.ts"

type ModelPrice = {
  input: number
  output: number
}

const modelPricesUsdPerMillion: Record<string, ModelPrice> = {
  "gpt-5.6-sol": { input: 5, output: 30 },
  "gpt-5.6-terra": { input: 2.5, output: 15 },
  "gpt-5.6-luna": { input: 1, output: 6 },
}

const fallbackPriceUsdPerMillion: ModelPrice = { input: 0.1, output: 0.3 }

export const dailyServiceCodeLimits: Readonly<Record<string, { amountUsd: number; fractionDigits: number }>> = {
  athenz: { amountUsd: 240, fractionDigits: 2 },
  spire: { amountUsd: 0.002, fractionDigits: 3 },
}

export function estimatedModelCostUsd(usage: Pick<ModelUsage, "model" | "promptTokens" | "completionTokens">) {
  return estimatedTokenCostUsd(usage.model, usage.promptTokens, usage.completionTokens)
}

export function estimatedTokenCostUsd(model: string, inputTokens: number, outputTokens: number) {
  const price = modelPricesUsdPerMillion[model] ?? fallbackPriceUsdPerMillion
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000
}

export function estimatedUsageCostUsd(usage: ModelUsage[]) {
  return usage.reduce((total, model) => total + estimatedModelCostUsd(model), 0)
}
