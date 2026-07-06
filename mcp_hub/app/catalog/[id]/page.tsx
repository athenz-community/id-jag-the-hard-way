import { redirect } from "next/navigation"
import { consoleHref, DEFAULT_PRODUCT, DEFAULT_PROJECT } from "@/components/navigation/consoleRoute"

export default async function LegacyMcpServerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  redirect(
    consoleHref({
      project: DEFAULT_PROJECT,
      product: DEFAULT_PRODUCT,
      section: "catalog",
      suffix: `${id}/client-configuration`,
    }),
  )
}
