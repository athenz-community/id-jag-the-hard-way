import https from "https";
import fs from "fs";
import { URLSearchParams } from "url";
import jwt from "jsonwebtoken";
import { exchangeToIdjag } from "./idtokenIntoIdjag.js";
import { ZTS_URL, CERT_PATH, KEY_PATH, CA_PATH } from "../config/env.js";

const httpsAgent = new https.Agent({
  cert: fs.readFileSync(CERT_PATH),
  key: fs.readFileSync(KEY_PATH),
  ca: fs.readFileSync(CA_PATH),
});

const atCache = new Map<string, { token: string; exp: number }>();

function getExp(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64").toString());
    return payload.exp;
  } catch {
    return Math.floor(Date.now() / 1000) + 3600;
  }
}

// fetchATFromZTS actually calls to ZTS
async function fetchATFromZTS(idJag: string, scope: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: idJag,
      scope: scope,
    }).toString();

    const targetUrl = ZTS_URL.replace(/\/$/, "") + "/oauth2/token";
    const url = new URL(targetUrl);
    console.error(`[Athenz AT] 🎯 Target ZTS for AT: ${targetUrl}`);
    const req = https.request({
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      agent: httpsAgent,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      let data = "";
      res.on("data", (chunk) => data += chunk);
      res.on("end", () => {
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve(JSON.parse(data).access_token);
        } else {
          reject(new Error(`ZTS Error: ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// getAccessToken returns Access Token in raw string format
// cache feature for Athenz AT is disabled so that users can test themselves adding/removing members
const AT_CACHED = false;
export async function getAccessToken(req: any, scope: string): Promise<string> {
  if (AT_CACHED) {
    const cached = atCache.get(scope);

    // const now = Math.floor(Date.now() / 1000)
    if (cached && cached.exp > Math.floor(Date.now() / 1000) + 60) {
      console.error(`[Athenz AT] ⚡ Hit! Returning cached AT for scope: ${scope}`);
      return cached.token;
    } else {
      console.error(`[Athenz AT] 🚀 No cache found for Athenz Access Token with scope [${scope}]`);
    }
  } else {
    console.error(`[Athenz AT] Cache Feature for Athenz AT is now disabled`);
  }

  const idJag = await exchangeToIdjag(req, scope);

  console.error(`[Athenz AT] Fetching Athenz Access Token using ID-JAG ...`);
  const accessToken = await fetchATFromZTS(idJag, scope);
  
  const decoded = jwt.decode(accessToken) as any;
  const grantedScope = decoded?.scp ?? decoded?.scope ?? "(none)";
  console.error(`[Athenz AT] 🔑 Successfully fetched Athenz Access Token. Granted scope: ${JSON.stringify(grantedScope)}`);
  atCache.set(scope, { token: accessToken, exp: getExp(accessToken) });

  return accessToken;
}
