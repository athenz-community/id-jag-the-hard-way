import { redirect } from "next/navigation"
import { consoleHref, DEFAULT_PRODUCT, DEFAULT_PROJECT } from "@/components/navigation/consoleRoute"

export default function HomePage() {
  redirect(consoleHref({ project: DEFAULT_PROJECT, product: DEFAULT_PRODUCT, section: "catalog" }))
}
