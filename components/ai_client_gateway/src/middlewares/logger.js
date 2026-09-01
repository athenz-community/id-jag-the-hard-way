import { DEBUG_HEADERS } from "../config/env.js";
import { extractCookieValue } from "../utils/httpHelpers.js";

const DISABLED = true;

// TODO: Kind of useless, but left for reference sake.

export function logIncomingRequest(req, forwardedHeaders) {
  if (DISABLED) return;

  const authHeader = req.headers.authorization;
  const cookieHeader = req.headers.cookie;
  const oauthSessionId = extractCookieValue(cookieHeader, "oauth_session_id");
  const timestamp = new Date().toISOString();
  const clientIp = req.ip || req.connection?.remoteAddress;

  console.error(`\n[${timestamp}] ================= OPENWEBUI -> GATEWAY =================`);
  console.error(`[Info]         : Received from IP ${clientIp}`);
  console.error(`[Method]       : ${req.method}`);
  console.error(`[Path]         : ${req.originalUrl}`);
  
  console.error(`[Authorization]: ${authHeader ? authHeader : "(none)"}`);
  console.error(`[Cookie]       : ${cookieHeader ? cookieHeader : "(none)"}`);
  console.error(`[oauth_session_id]: ${oauthSessionId ? oauthSessionId : "(none)"}`);

  if (DEBUG_HEADERS) {
    console.error(`[Forward Headers]:\n${JSON.stringify(forwardedHeaders, null, 2)}`);
  }

  console.error("=======================================================================\n");
}
