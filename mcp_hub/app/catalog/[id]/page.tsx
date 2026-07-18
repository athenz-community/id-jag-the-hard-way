import { redirect } from "next/navigation"
import { catalogServerSuffix, consoleHref, decodeRouteParam, DEFAULT_PRODUCT, DEFAULT_PROJECT } from "@/components/navigation/consoleRoute"

export default async function LegacyMcpServerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const serverId = decodeRouteParam(id)

  redirect(
    consoleHref({
      project: DEFAULT_PROJECT,
      product: DEFAULT_PRODUCT,
      section: "catalog",
      suffix: catalogServerSuffix(serverId, "client-configuration"),
    }),
  )
}
