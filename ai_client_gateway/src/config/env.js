import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const CERT_PATH = path.join(__dirname, "../../certs/ai-client-gateway.crt");
export const KEY_PATH = path.join(__dirname, "../../certs/ai-client-gateway.key");
export const CA_PATH = path.join(__dirname, "../../certs/ca.crt");

export const PORT = Number(process.env.PORT ?? 3101);
export const UPSTREAM_BASE_URL = process.env.UPSTREAM_BASE_URL ?? "http://localhost:8101";
export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://localhost:${PORT}`;
export const DEBUG_HEADERS = process.env.DEBUG_HEADERS === "true";
export const ZTS_URL = process.env.ZTS_URL ?? "https://athenz-zts-server.athenz:4443/zts/v1";

// OAuth2 / Keycloak settings (used by the gateway's built-in authorization server)
export const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? "http://localhost:34443";
export const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? "master";
export const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "claude-code";

// DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN=true will output the access token fetched as a log.
export const DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN = process.env.DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN === "true";

const CORS_ORIGINS = (
  process.env.CORS_ORIGINS ??
  "http://localhost:3000,http://localhost:3001,http://localhost:8080"
)
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

export const corsOptions = {
  origin(origin, callback) {
    const isLocalhost = origin && (
      origin.startsWith("http://localhost:") ||
      origin.startsWith("http://127.0.0.1:")
    );

    if (!origin || CORS_ORIGINS.includes(origin) || isLocalhost) {
      return callback(null, true);
    }
    return callback(new Error(`CORS blocked origin: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "authorization",
    "content-type",
    "accept",
    "cookie",
    "x-openwebui-user-id",
    "x-openwebui-user-email",
    "x-openwebui-user-name",
    "x-openwebui-user-role",
    "x-openwebui-chat-id",
    "x-openwebui-message-id",
    "x-open-webui-user-id",
    "x-open-webui-user-email",
    "x-open-webui-user-name",
    "x-open-webui-user-role",
    "x-open-webui-chat-id",
    "x-open-webui-message-id"
  ]
};
