import dotenv from "dotenv";
dotenv.config();

export const PORT = process.env.PORT || 8101;
export const UPSTREAM_BASE_URL = process.env.UPSTREAM_BASE_URL || "http://localhost:14443";
export const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
export const AUTHORIZATION_SERVER_URL = process.env.AUTHORIZATION_SERVER_URL || "https://athenz-zts-server.athenz:4443/zts/v1"

// logger:
export const LOGGER_ENABLE_HEADERS = process.env.LOGGER_ENABLE_HEADERS || false;
export const LOGGER_ENABLE_BODY = process.env.LOGGER_ENABLE_BODY || true;

export const corsOptions = {
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-athenz-api-token"],
};
