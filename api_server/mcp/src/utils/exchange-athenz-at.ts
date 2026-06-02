import fs from "fs";
import https from "https";
import path from "path";
import { fileURLToPath } from "url";
import { Request } from "express";
import { getAtFromReq } from "./readAtFromReq";
import { AUTHORIZATION_SERVER_URL } from "../config/env";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CERT_PATH = path.join(__dirname, "../../certs/api-mcp.crt");
const KEY_PATH = path.join(__dirname, "../../certs/api-mcp.key");
const CA_PATH = path.join(__dirname, "../../certs/ca.crt");

const cert = fs.readFileSync(CERT_PATH);
const key = fs.readFileSync(KEY_PATH);
const ca = fs.readFileSync(CA_PATH);

export async function exchangeAthenzAT(req: Request, scope: string): Promise<string> {
  const audience = scope.split(":role.")[0]

  const receivedToken = getAtFromReq(req);
  if (!receivedToken) {
    throw new Error("No Access Token found in request header");
  }

  console.log(`[INFO] [Token Exchange] Initiating for scope: "${scope}" using api-mcp cert`);

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
            console.log(`[INFO] [Token Exchange] ✅ Success! Exchanged for ${scope}`);
            resolve(result.access_token);
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
