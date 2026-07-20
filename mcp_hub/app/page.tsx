import { redirect } from "next/navigation"
import { consoleHref, DEFAULT_PROJECT, GENAI_PRODUCT } from "@/components/navigation/consoleRoute"

export default function HomePage() {
  redirect(consoleHref({ project: DEFAULT_PROJECT, product: GENAI_PRODUCT, section: "monitoring" }))
}
