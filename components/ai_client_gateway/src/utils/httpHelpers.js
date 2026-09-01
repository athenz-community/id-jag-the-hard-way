const HOP_BY_HOP_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length"
]);

export function normalizeHeaderValue(value) {
  if (Array.isArray(value)) return value.join(", ");
  if (value === undefined || value === null) return undefined;
  return String(value);
}

export function shouldForwardRequestHeader(name) {
  const lower = name.toLowerCase();

  if (HOP_BY_HOP_HEADERS.has(lower)) return false;

  if (lower === "authorization" || lower === "cookie" || lower === "content-type" || lower === "accept") {
    return true;
  }

  if (lower.startsWith("x-openwebui-") || lower.startsWith("x-open-webui-")) {
    return true;
  }

  return false;
}

export function collectForwardHeaders(req) {
  const headers = {};

  for (const [name, value] of Object.entries(req.headers)) {
    if (!shouldForwardRequestHeader(name)) continue;
    
    const normalized = normalizeHeaderValue(value);
    if (normalized !== undefined) {
      headers[name] = normalized;
    }
  }

  headers["x-ai-gateway"] = "openwebui-openapi-gateway";
  return headers;
}

export function extractCookieValue(cookieHeader, cookieName) {
  if (!cookieHeader) return undefined;

  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (rawName === cookieName) {
      return rawValue.join("=");
    }
  }

  return undefined;
}
