import "server-only"

import type { Session } from "next-auth"
import { redirect } from "next/navigation"
import { auth } from "@/features/auth/lib/auth"

type AuthenticatedHubSession = Session & {
  idToken: string
  user: Session["user"] & { username: string }
}

export async function requireHubSession(): Promise<AuthenticatedHubSession> {
  const session = await auth()
  if (!session?.user?.username || !session.idToken) redirect("/")
  return session as AuthenticatedHubSession
}

export function athenzUserPrincipal(username: string) {
  const domain = process.env.MCP_HUB_ATHENZ_USER_DOMAIN ?? "user"
  return `${domain}.${username}`
}
