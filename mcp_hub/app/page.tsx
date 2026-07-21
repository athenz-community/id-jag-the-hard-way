import { redirect } from "next/navigation"
import { consoleHref, DEFAULT_PROJECT, GENAI_PRODUCT } from "@/components/navigation/consoleRoute"
import { signInToIdp } from "@/features/auth/actions/idp"
import { idpConfig } from "@/features/auth/config/idp"
import { auth } from "@/features/auth/lib/auth"

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const session = await auth()
  if (session?.user) {
    redirect(consoleHref({ project: DEFAULT_PROJECT, product: GENAI_PRODUCT, section: "monitoring" }))
  }

  const { error } = await searchParams

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand-mark" aria-hidden="true">M</div>
        <p className="login-eyebrow">IDTHW</p>
        <h1>Sign in to MCP Hub</h1>
        <p>Use your organization identity to access the hub as your own user.</p>
        {error ? (
          <p className="login-error">
            Sign-in failed. The IdP account must provide a preferred_username claim.
          </p>
        ) : null}
        <form action={signInToIdp}>
          <button className="login-button" type="submit">
            Continue with {idpConfig.name}
          </button>
        </form>
      </section>
    </main>
  )
}
