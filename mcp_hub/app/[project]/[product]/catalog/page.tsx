import { ConsoleTemplate } from "@/components/templates/ConsoleTemplate"
import {
  CatalogBreadcrumb,
  CatalogError,
  CatalogFilters,
  CatalogHeader,
  CatalogPagination,
  CatalogTable,
  CatalogTabs,
} from "@/features/catalog/components/CatalogPage"
import { fetchCatalog } from "@/features/catalog/lib/fetchCatalog"

export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function ProjectCatalogRoute({ params }: { params: Promise<{ project: string; product: string }> }) {
  const { project, product } = await params
  const catalog = await fetchCatalog()

  return (
    <ConsoleTemplate>
      <CatalogBreadcrumb project={project} product={product} />
      <CatalogHeader />
      <CatalogTabs />
      <CatalogFilters />
      <CatalogError error={catalog.error} />
      <CatalogTable servers={catalog.servers} project={project} product={product} />
      <CatalogPagination />
    </ConsoleTemplate>
  )
}
