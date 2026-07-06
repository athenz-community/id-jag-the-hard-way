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
    zmsUrl: process.env.ZMS_URL ?? "https://localhost:4443/zms/v1",
    ztsUrl: process.env.ZTS_URL ?? "https://localhost:8443/zts/v1",
    // Canonical ZTS audience for ID-JAG — must match what ZTS expects, NOT the port-forward URL
    ztsAudience: process.env.ZTS_AUDIENCE ?? "https://athenz-zts-server.athenz:4443/zts/v1",
    certPath: process.env.UI_CERT_PATH ?? "./certs/org.idjag-ui.crt",
    keyPath: process.env.UI_KEY_PATH ?? "./certs/org.idjag-ui.key",
    adminCertPath: process.env.ZMS_ADMIN_CERT_PATH ?? "../athenz_dist/certs/athenz_admin.cert.pem",
    adminKeyPath: process.env.ZMS_ADMIN_KEY_PATH ?? "../athenz_dist/keys/athenz_admin.private.pem",
  },
} as const;
