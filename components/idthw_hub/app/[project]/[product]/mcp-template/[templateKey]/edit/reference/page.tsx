import { EditMcpTemplatePage } from "../EditMcpTemplatePage"

export const dynamic = "force-dynamic"

export default function EditMcpTemplateReferenceRoute({
  params,
}: {
  params: Promise<{ project: string; product: string; templateKey: string }>
}) {
  return <EditMcpTemplatePage activeStep="reference" params={params} />
}
