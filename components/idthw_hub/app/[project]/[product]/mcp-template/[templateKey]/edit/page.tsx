import { EditMcpTemplatePage } from "./EditMcpTemplatePage"

export const dynamic = "force-dynamic"

export default function EditMcpTemplateSourceRoute({
  params,
}: {
  params: Promise<{ project: string; product: string; templateKey: string }>
}) {
  return <EditMcpTemplatePage activeStep="source" params={params} />
}
