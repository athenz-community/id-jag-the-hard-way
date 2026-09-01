import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import { Request } from "express";
import { getAtFromReq } from "./readAtFromReq";
import { AUTHORIZATION_SERVER_URL, DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN } from "../config/env";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CERT_DIR = process.env.MCP_CERT_DIR || path.join(__dirname, "../../certs");
const CERT_PATH = process.env.ATHENZ_CERT_PATH || path.join(CERT_DIR, "api-mcp.crt");
const KEY_PATH = process.env.ATHENZ_KEY_PATH || path.join(CERT_DIR, "api-mcp.key");
const CA_PATH = process.env.ATHENZ_CA_PATH || path.join(CERT_DIR, "ca.crt");

const cert = fs.readFileSync(CERT_PATH);
const key = fs.readFileSync(KEY_PATH);
const ca = fs.readFileSync(CA_PATH);

export async function exchangeAthenzAT(req: Request, scope: string): Promise<string> {
  const audience = scope.split(":role.")[0]

  const receivedToken = getAtFromReq(req);
  if (!receivedToken) {
    throw new Error("No Access Token found in request header");
  }

  const tokenDisplay = DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN ? `${receivedToken} (⚠️ Visible because DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN=${DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN})` : receivedToken.substring(0, 16) + "..."
  console.log(`[INFO] [Token Exchange] Initiating for scope: "${scope}" using ${CERT_PATH} cert, token: ${tokenDisplay}`);

  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
      subject_token: receivedToken,
      subject_token_type: "urn:ietf:params:oauth:token-type:access_token",
      scope,
      audience,
    });

    const body = params.toString();
    const endpoint = AUTHORIZATION_SERVER_URL + "/oauth2/token";

    const options: https.RequestOptions = {
      method: "POST",
      cert: cert,
      key: key,
      ca: ca,
      rejectUnauthorized: false, // local only
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 10000,
    };

    const httpsReq = https.request(endpoint, options, (res) => {
      let responseData = "";
      res.on("data", (chunk) => (responseData += chunk));
      res.on("end", () => {
        if (res.statusCode === 200) {
          try {
            const result = JSON.parse(responseData);
            const accessToken = result.access_token;
            const decoded = JSON.parse(Buffer.from(accessToken.split(".")[1], "base64").toString());
            const grantedScope = decoded?.scp ?? decoded?.scope ?? "(none)";
            const tokenDisplay = DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN ? `${accessToken} (⚠️ Visible because DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN=${DANGEROUSLY_SHOW_RAW_ACCESS_TOKEN})` : accessToken.substring(0, 16) + "...";
            console.log(`[INFO] [Token Exchange] ✅ Success! scope: ${JSON.stringify(scope.split(" "))} gotScope: ${JSON.stringify(grantedScope)} token: ${tokenDisplay}`);
            resolve(accessToken);
          } catch (e) {
            reject(new Error("Failed to parse ZTS response"));
          }
        } else {
          console.error(`[ERROR] [Token Exchange] Status: ${res.statusCode}, Body: ${responseData}`);
          reject(new Error(`Exchange failed: ${res.statusCode} ${responseData}`));
        }
      });
    });

    httpsReq.on("error", (err) => {
      console.error(`[ERROR] [Token Exchange] Network error: ${err.message}`);
      reject(err);
    });

    httpsReq.write(body);
    httpsReq.end();
  });
}
