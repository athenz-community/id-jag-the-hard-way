export function parseAthenzServiceList(payload: unknown, domain: string) {
  if (!isRecord(payload) || !Array.isArray(payload.names)) {
    throw new Error("ZMS returned an invalid service list")
  }

  const servicePrefix = `${domain}.`
  const services = payload.names.map((value) => {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error("ZMS returned an invalid service name")
    }
    return value.startsWith(servicePrefix) ? value : `${servicePrefix}${value}`
  })

  return [...new Set(services)].sort((left, right) => left.localeCompare(right))
}

export function athenzServiceName(servicePrincipal: string) {
  return servicePrincipal.split(".").at(-1) ?? servicePrincipal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}
