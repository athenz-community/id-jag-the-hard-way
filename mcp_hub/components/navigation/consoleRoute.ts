export const DEFAULT_PROJECT = "k8s-docs-server"
export const DEFAULT_PRODUCT = "mcp-hub"
export const DEFAULT_SECTION = "catalog"

export type ConsoleSection = "catalog" | "mcp-server" | "mcp-template" | "playground" | "approval"

export type ConsoleRoute = {
  project: string
  product: string
  section: ConsoleSection
}

const SECTION_SLUGS = new Set<ConsoleSection>(["catalog", "mcp-server", "mcp-template", "playground", "approval"])

export function parseConsoleRoute(pathname: string): ConsoleRoute {
  const [project, product, section] = pathname.split("/").filter(Boolean)
  const normalizedSection = SECTION_SLUGS.has(section as ConsoleSection) ? (section as ConsoleSection) : DEFAULT_SECTION

  return {
    project: project ?? DEFAULT_PROJECT,
    product: product ?? DEFAULT_PRODUCT,
    section: normalizedSection,
  }
}

export function consoleHref({
  project,
  product,
  section = DEFAULT_SECTION,
  suffix = "",
}: {
  project: string
  product: string
  section?: ConsoleSection
  suffix?: string
}) {
  const base = `/${encodeURIComponent(project)}/${encodeURIComponent(product)}/${section}`
  return suffix ? `${base}/${suffix.replace(/^\/+/, "")}` : base
}

export function catalogServerSuffix(serverId: string, view: "client-configuration" | "tools") {
  return `${encodeURIComponent(serverId)}/${view}`
}

export function decodeRouteParam(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function displayProduct(product: string) {
  if (product === "mcp-hub") return "MCP hub"
  return product
    .split("-")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ")
}
