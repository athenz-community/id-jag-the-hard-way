/**
 * OAuth2 Authorization Server routes for Claude Code MCP integration.
 *
 * Claude Code discovers the gateway acts as an OAuth2 AS via
 * GET /.well-known/oauth-authorization-server, then drives a
 * standard PKCE authorization_code flow. The gateway acts as a
 * thin shell that redirects to Keycloak and stores the resulting
 * ID token in a local session. The rest of the ID-JAG chain
 * (ID token → ID-JAG → Athenz AT) runs unchanged inside the proxy.
 *
 * Required env vars:
 *   KEYCLOAK_URL      e.g. http://localhost:34443
 *   KEYCLOAK_REALM    e.g. master
 *   KEYCLOAK_CLIENT_ID  e.g. ai.open-webui
 *   PUBLIC_BASE_URL   e.g. http://localhost:44443  (must be reachable by browser)
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import { URLSearchParams } from "url";
import { PUBLIC_BASE_URL } from "../config/env.js";
import { createSession, getSession } from "../utils/sessionStore.js";

const router = Router();

const KEYCLOAK_URL = process.env.KEYCLOAK_URL ?? "http://localhost:34443";
const KEYCLOAK_PUBLIC_URL = process.env.KEYCLOAK_PUBLIC_URL ?? KEYCLOAK_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM ?? "master";
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID ?? "claude-code";
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET;

// code_verifier is only needed on the gateway side for state validation;
// Keycloak uses its own PKCE challenge sent from here.
const pendingStates = new Map<string, { codeVerifier: string; redirectUri: string }>();

// Server-side token exchange uses the in-cluster address.
function keycloakBase(): string {
  return `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect`;
}

// Browser-facing redirects must use the publicly reachable address.
function keycloakPublicBase(): string {
  return `${KEYCLOAK_PUBLIC_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect`;
}

// RFC 7636 helpers
function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function generateVerifier(): string {
  return base64url(crypto.randomBytes(32));
}
function deriveChallenge(verifier: string): string {
  return base64url(crypto.createHash("sha256").update(verifier).digest());
}

// ── metadata ──────────────────────────────────────────────────────────────────

router.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
  res.json({
    issuer: PUBLIC_BASE_URL,
    authorization_endpoint: `${PUBLIC_BASE_URL}/oauth/authorize`,
    token_endpoint: `${PUBLIC_BASE_URL}/oauth/token`,
    registration_endpoint: `${PUBLIC_BASE_URL}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
  });
});

// ── dynamic client registration (RFC 7591) ────────────────────────────────────
// Claude Code requires this endpoint to exist. We accept any registration and
// return a stable client_id — the actual Keycloak client is always CLIENT_ID.

router.post("/oauth/register", (req: Request, res: Response) => {
  const body = req.body as Record<string, any> ?? {};
  const issuedClientId = body.client_id ?? `mcp-client-${crypto.randomUUID()}`;

  res.status(201).json({
    client_id: issuedClientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: body.redirect_uris ?? [],
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  });
});

// ── authorize ─────────────────────────────────────────────────────────────────

router.get("/oauth/authorize", (req: Request, res: Response) => {
  const { redirect_uri, state, code_challenge } = req.query as Record<string, string>;

  if (!redirect_uri || !state) {
    res.status(400).send("Missing redirect_uri or state");
    return;
  }

  const codeVerifier = generateVerifier();
  const challenge = deriveChallenge(codeVerifier);

  pendingStates.set(state, { codeVerifier, redirectUri: redirect_uri });

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: `${PUBLIC_BASE_URL}/oauth/callback`,
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  res.redirect(`${keycloakPublicBase()}/auth?${params}`);
});

// ── callback ──────────────────────────────────────────────────────────────────

router.get("/oauth/callback", async (req: Request, res: Response) => {
  const { code, state, error: kErr } = req.query as Record<string, string>;

  if (kErr) {
    res.status(400).send(`Keycloak error: ${kErr}`);
    return;
  }

  const pending = state ? pendingStates.get(state) : null;
  if (!pending || !code) {
    res.status(400).send("Invalid state or missing code");
    return;
  }
  pendingStates.delete(state);

  try {
    // Exchange the Keycloak code for tokens
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      ...(CLIENT_SECRET ? { client_secret: CLIENT_SECRET } : {}),
      code,
      redirect_uri: `${PUBLIC_BASE_URL}/oauth/callback`,
      code_verifier: pending.codeVerifier,
    });

    const tokenRes = await fetch(`${keycloakBase()}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      res.status(502).send(`Keycloak token exchange failed: ${tokenRes.status} ${text}`);
      return;
    }

    const tokenData: any = await tokenRes.json();
    const idToken: string = tokenData.id_token;

    if (!idToken) {
      res.status(502).send("Keycloak did not return an id_token");
      return;
    }

    // Parse expiry from id_token payload
    let exp = Math.floor(Date.now() / 1000) + 3600;
    try {
      const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64").toString());
      if (payload.exp) exp = payload.exp;
    } catch { /* keep default */ }

    const sessionToken = createSession(idToken, exp);

    // Redirect back to Claude Code's redirect_uri with our session token as the code
    const callbackParams = new URLSearchParams({ code: sessionToken, state });
    res.redirect(`${pending.redirectUri}?${callbackParams}`);
  } catch (err: any) {
    res.status(500).send(`Callback error: ${err.message}`);
  }
});

// ── token ─────────────────────────────────────────────────────────────────────

router.post("/oauth/token", (req: Request, res: Response) => {
  // Claude Code posts the code (which is actually our session token) here
  const body = req.body as Record<string, string>;
  const code = body.code ?? (typeof req.body === "string"
    ? new URLSearchParams(req.body).get("code")
    : null);

  if (!code) {
    res.status(400).json({ error: "invalid_request", error_description: "Missing code" });
    return;
  }

  const session = getSession(code);
  if (!session) {
    res.status(400).json({ error: "invalid_grant", error_description: "Code not found or expired" });
    return;
  }

  const expiresIn = Math.max(0, session.exp - Math.floor(Date.now() / 1000));

  res.json({
    access_token: code,      // re-use the session token as the bearer
    token_type: "Bearer",
    expires_in: expiresIn,
    scope: "openid email profile",
  });
});

export default router;
