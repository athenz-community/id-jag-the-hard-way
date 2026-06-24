export const config = {
  idp: {
    clientId: process.env.AUTH_KEYCLOAK_ID!,
    clientSecret: process.env.AUTH_KEYCLOAK_SECRET ?? "",
    issuer: process.env.AUTH_KEYCLOAK_ISSUER ?? "http://localhost:34443/realms/master",
  },
  api: {
    serverUrl: process.env.API_SERVER_URL ?? "http://localhost:14443",
  },
  athenz: {
    ztsUrl: process.env.ZTS_URL ?? "https://localhost:8443/zts/v1",
    // Canonical ZTS audience for ID-JAG — must match what ZTS expects, NOT the port-forward URL
    ztsAudience: process.env.ZTS_AUDIENCE ?? "https://athenz-zts-server.athenz:4443/zts/v1",
    certPath: process.env.UI_CERT_PATH ?? "./certs/org.idjag-ui.crt",
    keyPath: process.env.UI_KEY_PATH ?? "./certs/org.idjag-ui.key",
  },
} as const;
