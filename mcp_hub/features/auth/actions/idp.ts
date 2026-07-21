"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { consoleHref, DEFAULT_PROJECT, GENAI_PRODUCT } from "@/components/navigation/consoleRoute"
import { idpConfig, IDP_PROVIDER_ID } from "@/features/auth/config/idp"
import { auth, signIn, signOut, updateSession } from "@/features/auth/lib/auth"

const DEFAULT_DESTINATION = consoleHref({
  project: DEFAULT_PROJECT,
  product: GENAI_PRODUCT,
  section: "monitoring",
})

export async function signInToIdp() {
  await signIn(IDP_PROVIDER_ID, { redirectTo: DEFAULT_DESTINATION })
}

export async function signInAsDifferentUser() {
  await signIn(IDP_PROVIDER_ID, { redirectTo: DEFAULT_DESTINATION }, { prompt: "login" })
}

function safeDestination(value: FormDataEntryValue | null) {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : DEFAULT_DESTINATION
}

export async function switchIdpUser(formData: FormData) {
  const subject = formData.get("subject")
  if (typeof subject !== "string" || !subject) return

  await updateSession({ activeSubject: subject })
  redirect(safeDestination(formData.get("returnTo")))
}

function requestOrigin(requestHeaders: Headers) {
  if (process.env.AUTH_URL) return new URL(process.env.AUTH_URL).origin

  const host = requestHeaders.get("x-forwarded-host")?.split(",")[0]?.trim()
    ?? requestHeaders.get("host")
  const protocol = requestHeaders.get("x-forwarded-proto")?.split(",")[0]?.trim()
    ?? (process.env.NODE_ENV === "production" ? "https" : "http")

  if (!host) throw new Error("Cannot determine MCP Hub origin for IdP logout")
  return `${protocol}://${host}`
}

export async function signOutFromIdp() {
  const session = await auth()
  if (!session) {
    await signOut({ redirectTo: "/" })
    return
  }

  const origin = requestOrigin(await headers())
  const logoutUrl = new URL(idpConfig.endSessionEndpoint)
  if (session.idToken) logoutUrl.searchParams.set("id_token_hint", session.idToken)
  logoutUrl.searchParams.set("client_id", idpConfig.clientId)
  logoutUrl.searchParams.set(
    "post_logout_redirect_uri",
    `${origin}/api/auth/idp-logout/complete`,
  )
  redirect(logoutUrl.toString())
}
