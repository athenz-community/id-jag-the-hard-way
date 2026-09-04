export function normalizeMcpKeyName(value: string) {
  return value.toLowerCase().replace(/\s+/g, "-")
}
