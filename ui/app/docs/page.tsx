import { auth } from "@/shared/lib/auth";
import { redirect } from "next/navigation";
import DocsPageClient from "@/features/docs/ui/DocsPageClient";

export default async function DocsPage() {
  const session = await auth();
  if (!session) redirect("/");

  const docs: { id: number; name: string; content: string }[] = [];
  const fetchError: string | null = null;

  return (
    <main className="min-h-screen p-6 md:p-10" style={{ background: "var(--bg)" }}>
      <div className="max-w-3xl mx-auto space-y-6">
        <DocsPageClient docs={docs} fetchError={fetchError} user={session.user} />
      </div>
    </main>
  );
}
