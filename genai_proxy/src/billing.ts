import type { ModelUsage } from "./usage.ts"

type ModelPrice = {
  input: number
  output: number
}

const modelPricesUsdPerMillion: Record<string, ModelPrice> = {
  "gemma4:26b": { input: 0.1, output: 0.3 },
  "gemma4:31b": { input: 0.12, output: 0.36 },
}

const fallbackPriceUsdPerMillion: ModelPrice = { input: 0.1, output: 0.3 }

export const dailyServiceCodeLimits: Readonly<Record<string, { amountUsd: number; fractionDigits: number }>> = {
  athenz: { amountUsd: 0.24, fractionDigits: 2 },
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
