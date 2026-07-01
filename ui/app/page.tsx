import { auth } from "@/shared/lib/auth";
import { redirect } from "next/navigation";
import { SignInButton } from "@/features/auth/ui/SignInButton";

export default async function HomePage() {
  const session = await auth();
  if (session) redirect("/docs");

  return (
    <main
      className="min-h-screen flex flex-col items-center justify-center p-6"
      style={{ background: "var(--bg)" }}
    >
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="space-y-1">
          <div className="flex items-center justify-center 3ap-2 mb-3">
            <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: "var(--line-green)" }} />
            <span className="text-xs font-medium" style={{ color: "var(--line-green)" }}>ID-JAG Demo</span>
          </div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
            Welcome
          </h1>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            Sign in to create and view your documents.
          </p>
        </div>
        <SignInButton />
      </div>
    </main>
  );
}
