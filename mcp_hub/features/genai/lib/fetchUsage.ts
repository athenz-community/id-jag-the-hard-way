import type { GenAIUsageResponse } from "@/features/genai/types/usage"

const DEFAULT_GENAI_PROXY_URL = "http://127.0.0.1:64443"
const REPORT_USER = "idjag-learner"

export async function fetchGenAIUsage(): Promise<GenAIUsageResponse> {
  const baseUrl = (process.env.GENAI_PROXY_URL ?? DEFAULT_GENAI_PROXY_URL).replace(/\/+$/, "")

  try {
    const response = await fetch(`${baseUrl}/api/users/${encodeURIComponent(REPORT_USER)}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) throw new Error(`GenAI proxy returned HTTP ${response.status}`)

    const payload = await response.json() as GenAIUsageResponse
    if (!Array.isArray(payload.projects)) throw new Error("GenAI proxy returned an invalid usage response")
    return { projects: payload.projects }
  } catch (error) {
    return {
      projects: [],
      error: error instanceof Error ? error.message : "Unable to load GenAI usage",
    }
  }
}
