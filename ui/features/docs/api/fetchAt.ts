"use server";

import https from "https";
import fs from "fs";
import { URLSearchParams } from "url";
import { auth } from "@/shared/lib/auth";
import { config } from "@/shared/config";

const DEFAULT_SCOPE = "api:role.docs-getter";
const ID_JAG_AUD = config.athenz.ztsAudience;

function httpsAgent() {
  return new https.Agent({
    cert: fs.readFileSync(config.athenz.certPath),
    key: fs.readFileSync(config.athenz.keyPath),
    rejectUnauthorized: false, // self-signed cert in local dev
  });
}

function post(url: string, body: string, agent: https.Agent): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: "POST",
      agent,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (c) => data += c);
      res.on("end", () => res.statusCode! < 300 ? resolve(data) : reject(new Error(`HTTP ${res.statusCode}: ${data}`)));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

export async function fetchAccessToken(
  scope = DEFAULT_SCOPE
): Promise<{ at: string; scope: string; exp: number }> {
  const session = await auth();
  const idToken = (session as any)?.idToken as string | undefined;
  if (!idToken) throw new Error("Not authenticated");

  const agent = httpsAgent();
  const zts = config.athenz.ztsUrl.replace(/\/$/, "");

  // Step 1: ID token → ID-JAG
  const idJagBody = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    requested_token_type: "urn:ietf:params:oauth:token-type:id-jag",
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
    subject_token: idToken,
    scope,
    audience: ID_JAG_AUD,
  }).toString();
  const idJagRes = JSON.parse(await post(`${zts}/oauth2/token`, idJagBody, agent));
  const idJag: string = idJagRes.access_token;

  // Step 2: ID-JAG → scoped AT
  const atBody = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: idJag,
    scope,
  }).toString();
  const atRes = JSON.parse(await post(`${zts}/oauth2/token`, atBody, agent));
  const at: string = atRes.access_token;

  const payload = JSON.parse(Buffer.from(at.split(".")[1], "base64").toString());
  const grantedScope: string = Array.isArray(payload.scp)
    ? payload.scp.join(" ")
    : (payload.scp ?? payload.scope ?? scope);

  return { at, scope: grantedScope, exp: payload.exp };
}
