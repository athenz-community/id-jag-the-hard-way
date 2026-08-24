import { createApp } from "./app.js"
import { KEYCLOAK_ISSUER, MCP_HUB_REGISTRY_URL, PORT, PUBLIC_BASE_URL } from "./config/env.js"

createApp().listen(PORT, "0.0.0.0", () => {
  console.log(`MCP Gateway listening on 0.0.0.0:${PORT}`)
  console.log(`Public OAuth issuer: ${PUBLIC_BASE_URL}`)
  console.log(`Identity provider: ${KEYCLOAK_ISSUER}`)
  console.log(`MCP Hub registry: ${MCP_HUB_REGISTRY_URL}`)
})
