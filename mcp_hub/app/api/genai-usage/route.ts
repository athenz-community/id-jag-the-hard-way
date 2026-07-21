import { NextResponse } from "next/server"
import { auth } from "@/features/auth/lib/auth"
import { fetchGenAIUsage } from "@/features/genai/lib/fetchUsage"

export const dynamic = "force-dynamic"

export async function GET() {
  const session = await auth()
  if (!session?.user?.username) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 })
  }

  const usage = await fetchGenAIUsage(session.user.username)
  return NextResponse.json(usage, {
    status: usage.error ? 502 : 200,
    headers: { "Cache-Control": "no-store" },
  })
}
