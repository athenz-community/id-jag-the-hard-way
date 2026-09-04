export const IDP_PROVIDER_ID = "idp"

const issuer = process.env.MCP_HUB_IDP_ISSUER ?? "http://localhost:34443/realms/master"
const publicIssuer = process.env.MCP_HUB_IDP_PUBLIC_ISSUER ?? issuer
const authorizationEndpoint = process.env.MCP_HUB_IDP_AUTHORIZATION_ENDPOINT
  ?? (publicIssuer !== issuer
    ? `${publicIssuer.replace(/\/$/, "")}/protocol/openid-connect/auth`
    : undefined)

export const idpConfig = {
  name: process.env.MCP_HUB_IDP_NAME ?? "Keycloak",
  issuer,
  publicIssuer,
  wellKnown: process.env.MCP_HUB_IDP_WELL_KNOWN,
  authorizationEndpoint,
  clientId: process.env.MCP_HUB_IDP_CLIENT_ID ?? "mcp-hub.hub-ui",
  clientSecret: process.env.MCP_HUB_IDP_CLIENT_SECRET ?? "mcp-hub-local-secret",
  tokenEndpoint: process.env.MCP_HUB_IDP_TOKEN_ENDPOINT
    ?? `${issuer.replace(/\/$/, "")}/protocol/openid-connect/token`,
  endSessionEndpoint: process.env.MCP_HUB_IDP_END_SESSION_ENDPOINT
    ?? `${publicIssuer.replace(/\/$/, "")}/protocol/openid-connect/logout`,
} as const
