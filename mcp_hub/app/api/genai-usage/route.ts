import { NextResponse } from "next/server"
import { fetchGenAIUsage } from "@/features/genai/lib/fetchUsage"

export const dynamic = "force-dynamic"

export async function GET() {
  const usage = await fetchGenAIUsage()
  return NextResponse.json(usage, {
    status: usage.error ? 502 : 200,
    headers: { "Cache-Control": "no-store" },
  })
}
