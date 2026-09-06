export type ZmsPolicyAssertion = {
  action: string
  effect: "ALLOW" | "DENY"
  resource: string
  role: string
}

export function parseZmsPolicyList(body: string) {
  const payload = parseRecord(body, "policy list")
  const names: string[] = []
  const assertions: ZmsPolicyAssertion[] = []

  if (Array.isArray(payload.names)) {
    for (const value of payload.names) names.push(requireString(value, "policy name"))
  }
  if (Array.isArray(payload.policies)) {
    for (const value of payload.policies) {
      if (typeof value === "string") {
        names.push(requireString(value, "policy name"))
      } else {
        const policy = requireRecord(value, "policy")
        if (typeof policy.name === "string" && policy.name.trim()) names.push(policy.name)
        assertions.push(...parseAssertions(policy.assertions, "policy assertions"))
      }
    }
  }
  if (!Array.isArray(payload.names) && !Array.isArray(payload.policies)) {
    throw new Error("ZMS returned an invalid policy list")
  }

  return { assertions, names: [...new Set(names)] }
}

export function parseZmsPolicy(body: string) {
  const payload = parseRecord(body, "policy")
  return parseAssertions(payload.assertions, "policy assertions")
}

export function policyAssertionKey(assertion: ZmsPolicyAssertion) {
  return [assertion.effect, assertion.action, assertion.role, assertion.resource].join("\n")
}

function parseAssertions(value: unknown, location: string): ZmsPolicyAssertion[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`ZMS returned invalid ${location}`)
  return value.map((item) => {
    const assertion = requireRecord(item, "policy assertion")
    const effect = assertion.effect === undefined ? "ALLOW" : assertion.effect
    if (effect !== "ALLOW" && effect !== "DENY") {
      throw new Error("ZMS returned an invalid policy assertion effect")
    }
    return {
      action: requireString(assertion.action, "policy assertion action"),
      effect,
      resource: requireString(assertion.resource, "policy assertion resource"),
      role: requireString(assertion.role, "policy assertion role"),
    }
  })
}

function parseRecord(body: string, location: string) {
  let value: unknown
  try {
    value = JSON.parse(body) as unknown
  } catch {
    throw new Error(`ZMS returned invalid JSON for ${location}`)
  }
  return requireRecord(value, location)
}

function requireRecord(value: unknown, location: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`ZMS returned an invalid ${location}`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, location: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`ZMS returned an invalid ${location}`)
  }
  return value
}
