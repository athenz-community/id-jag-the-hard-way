import https from "https";
import fs from "fs";
import { URLSearchParams } from "url";
import { extractCookieValue } from "../utils/httpHelpers.js";
import path from "path";
import { fileURLToPath } from "url";
import { ZTS_URL } from "../config/env.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CERT_PATH = path.join(__dirname, "../../certs/open-webui.crt");
const KEY_PATH = path.join(__dirname, "../../certs/open-webui.key");
const CA_PATH = path.join(__dirname, "../../certs/ca.crt");
const ID_JAG_AUD = "https://athenz-zts-server.athenz:4443/zts/v1";

const httpsAgent = new https.Agent({
  cert: fs.readFileSync(CERT_PATH),
  key: fs.readFileSync(KEY_PATH),
  ca: fs.readFileSync(CA_PATH),
});

const tokenCache = new Map();

function getJwtExpiration(token) {
  try {
    const payloadBase64 = token.split(".")[1];
    const payload = JSON.parse(Buffer.from(payloadBase64, "base64").toString("utf8"));
    return payload.exp;
  } catch (error) {
    return null;
  }
}

async function exchangeIdTokenToIdJag(idToken, scope) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      requested_token_type: "urn:ietf:params:oauth:token-type:id-jag",
      subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
      subject_token: idToken,
      scope: scope,
      audience: ID_JAG_AUD,
    }).toString();

    const targetUrl = ZTS_URL.replace(/\/$/, "") + "/oauth2/token";
    const url = new URL(targetUrl);
    console.error(`[Athenz ID-JAG] 🎯 Target ZTS for ID-JAG: ${targetUrl}`);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname,
      method: "POST",
      agent: httpsAgent,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => { data += chunk; });
      res.on("end", () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(JSON.parse(data).access_token);
          } catch (e) {
            reject(new Error("Failed to parse Athenz ZTS Response"));
          }
        } else {
          reject(new Error(`Athenz ZTS Error: HTTP ${res.statusCode} - ${data}`));
        }
      });
    });

    req.on("error", (e) => reject(e));
    req.write(body);
    req.end();
  });
}

// exchangeToIdjag returns jag token through ID-JAG process,
// but if it holds the cache, it simply returns the cache ones
export async function exchangeToIdjag(req, scope) {
  const cookieHeader = req.headers.cookie;
  const idToken = extractCookieValue(cookieHeader, "oauth_id_token");

  const now = Math.floor(Date.now() / 1000);

  const cacheKey = scope; // for now it is simply use the scope as the key

  if (tokenCache.has(cacheKey)) {
    const cached = tokenCache.get(cacheKey);
    
    if (cached.exp > now + 60) {
      console.error(`[Athenz ID-JAG] ⚡ Successfully returned the cached id-jag for scope [${scope}] (Remaining: ${cached.exp - now} secs)`);
      return cached.idJag;
    } else {
      console.error(`[Athenz ID-JAG] 🗑️ Destroyed the stored cache with expired caching for scope [${scope}]`);
      tokenCache.delete(cacheKey);
    }
  } else {
    console.error(`[Athenz ID-JAG] No cache found for id-jag (Scope: ${scope})`);
  }

  console.error(`[Athenz ID-JAG] 🔄 Attempting to exchange new ID-JAG with id-token for scope [${scope}] ...`);
  const idJag = await exchangeIdTokenToIdJag(idToken, scope);
  
  const exp = getJwtExpiration(idJag) || (now + 3600);
  
  tokenCache.set(cacheKey, { idJag, exp });
  console.error(`[Athenz ID-JAG] 💾 Successfully exchanged and cached ID-JAG for scope [${scope}]`);

  return idJag;
}
