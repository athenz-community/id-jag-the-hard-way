import { type NextRequest, NextResponse } from "next/server"
import { auth } from "@/features/auth/lib/auth"
import { fetchAthenzServices } from "@/features/registration/lib/fetchAthenzServices"

export const dynamic = "force-dynamic"

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
}
const PROJECT_PATTERN = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/

export async function GET(request: NextRequest) {
  const session = await auth()
  if (!session?.user) {
    return NextResponse.json(
      { error: "Authentication required" },
      { status: 401, headers: NO_STORE_HEADERS },
    )
  }

  const project = request.nextUrl.searchParams.get("project") ?? ""
  if (!PROJECT_PATTERN.test(project)) {
    return NextResponse.json(
      { error: "Invalid project" },
      { status: 400, headers: NO_STORE_HEADERS },
    )
  }

  const domain = `mcp-hub.mcps.${project}`
  try {
    const services = await fetchAthenzServices(domain)
    return NextResponse.json({ domain, services }, { headers: NO_STORE_HEADERS })
  } catch {
    return NextResponse.json(
      { error: "Unable to load Athenz services" },
      { status: 502, headers: NO_STORE_HEADERS },
    )
  }
}
