# MCP Runtime Proxy

`mcp-runtime-proxy` is the pod-local Athenz-protected front door for an MCP server. It verifies the Gateway-issued Athenz access token before forwarding protected MCP requests to the colocated MCP container.

The proxy verifies the JWT's RS256 signature against ZTS JWKS, requires an unexpired token, checks the configured audience, and requires the configured accessor scope. It does not fetch Athenz policies: successful token issuance and the signed token claims are the authorization evidence for this shared server-access boundary.

MCP protocol bootstrap, `ping`, and `tools/list` remain public so the Hub can discover tools before a user has access. Other requests fail closed with `401` for a missing or invalid token, `403` for a missing scope, and `503` when ZTS signing keys cannot be loaded. Denials are logged without logging the token.

Runtime logs are one-line JSON records with a request ID. Protected calls emit `request_received`, `access_token_verified`, and `request_completed` events. The verified event includes the signed token's subject, user ID, client ID, audiences, scopes, signing-key ID, and expiry information. Public calls and failures have distinct events. Authorization headers and raw token values are never logged.

## Request path

```text
MCP client
  -> MCP Gateway
  -> Core MCP Proxy
  -> Kubernetes Service
  -> MCP Runtime Proxy :8082
  -> MCP container on MCP_TARGET_URL
```

The MCP credential broker remains on the client. MCP Gateway exchanges the signed-in user's identity for the narrowly scoped Athenz access token. The Runtime Proxy validates that token and preserves its `Authorization` header for the colocated MCP container. It must target that container directly; targeting MCP Gateway would create a routing loop.

For a configured downstream tool scope, Gateway also sends the selected scope in the internal `x-idthw-mcp-downstream-scope` header. Runtime Proxy requires that exact fully qualified scope in the verified incoming token, strips the internal header, and uses its managed MCP service certificate for RFC 8693 access-token exchange. It writes the exchanged token atomically to a unique request file:

```text
/var/run/idthw-access-tokens/<tool-name>/<request-uuid>.jwt
```

The forwarded `tools/call` receives the path in `params._meta["mcp.idthw.dev/access-token-file"]`. The MCP container mounts this directory read-only and must reread the file immediately before the downstream request. Runtime Proxy removes the file after the MCP response ends. Per-request paths prevent concurrent users of the same tool from overwriting each other's delegated tokens. The initial implementation accepts downstream scopes from exactly one Athenz domain per tool call.

For new Hub-managed servers, Runtime Proxy also manages the selected Athenz service identity. Its bootstrap private-key Secret is mounted only in this container. On startup, the proxy uses `zts-svccert` and the registered `idthw-hub-generated` key to obtain a service certificate, verifies that the certificate matches the private key, and publishes both into a separate Kubernetes Secret. Runtime Proxy and the MCP container both mount that published identity read-only as `/var/run/athenz/service.cert.pem` and `/var/run/athenz/service.key.pem`. The proxy refreshes the identity every 24 hours and retries a failed scheduled refresh after five minutes without deleting the last good identity.

## Configuration

| Environment variable | Default | Purpose |
|---|---|---|
| `PORT` | `8082` | Runtime Proxy listening port |
| `MCP_TARGET_URL` | `http://127.0.0.1:8080` | Base URL of the MCP container in the same pod |
| `ATHENZ_JWKS_URL` | `https://athenz-zts-server.athenz:4443/zts/v1/oauth2/keys?rfc=true` | ZTS signing-key endpoint |
| `ATHENZ_JWKS_CA_PATH` | `/var/run/athenz/ca.crt` | CA used to authenticate the HTTPS JWKS endpoint |
| `ATHENZ_JWKS_CACHE_TTL_SECONDS` | `300` | In-memory JWKS cache lifetime |
| `ATHENZ_EXPECTED_AUDIENCE` | Required | Athenz domain accepted in the token `aud` claim |
| `ATHENZ_REQUIRED_SCOPE` | Required | Fully qualified `<domain>:role.<role>` required in `scp` or `scope` |
| `ATHENZ_JWKS_ALLOW_INSECURE_HTTP` | `false` | Allows an HTTP JWKS endpoint for local tests only |
| `ATHENZ_SERVICE_DOMAIN` | Unset | Enables identity refresh and names the selected Athenz service domain |
| `ATHENZ_SERVICE_NAME` | Unset | Selected Athenz service name; required with `ATHENZ_SERVICE_DOMAIN` |
| `ATHENZ_SERVICE_KEY_ID` | `idthw-hub-generated` | Registered Athenz service public-key ID |
| `ATHENZ_ZTS_URL` | `https://athenz-zts-server.athenz:4443/zts/v1` | ZTS service-certificate endpoint |
| `ATHENZ_ZTS_CA_PATH` | `/var/run/athenz/ca.crt` | CA used for service-certificate issuance |
| `ATHENZ_ZTS_DNS_DOMAIN` | `zts.athenz.cloud` | DNS suffix requested in the service certificate |
| `ATHENZ_BOOTSTRAP_PRIVATE_KEY_PATH` | `/var/run/athenz-bootstrap/service.key.pem` | Runtime-Proxy-only generated private key |
| `ATHENZ_PUBLISHED_CERT_PATH` | `/var/run/athenz-identity/service.cert.pem` | Projected identity Secret path used to confirm publication |
| `ATHENZ_IDENTITY_REFRESH_SECONDS` | `86400` | Successful certificate refresh interval |
| `ATHENZ_IDENTITY_RETRY_SECONDS` | `300` | Retry interval after a scheduled refresh failure |
| `ATHENZ_TOKEN_FILE_EXCHANGE_ENABLED` | `false` | Enables request-scoped downstream AT exchange and publication |
| `ATHENZ_TOKEN_EXCHANGE_URL` | `https://athenz-zts-server.athenz:4443/zts/v1/oauth2/token` | ZTS RFC 8693 token endpoint |
| `ATHENZ_TOKEN_EXCHANGE_CERT_PATH` | `/var/run/athenz/service.cert.pem` | MCP service certificate used for exchange |
| `ATHENZ_TOKEN_EXCHANGE_KEY_PATH` | `/var/run/athenz/service.key.pem` | MCP service private key used for exchange |
| `ATHENZ_TOKEN_EXCHANGE_CA_PATH` | `/var/run/athenz/ca.crt` | CA used to authenticate the token endpoint |
| `ATHENZ_TOKEN_FILE_DIR` | `/var/run/idthw-access-tokens` | Shared per-request token directory |
| `ATHENZ_TOKEN_EXCHANGE_TIMEOUT_MS` | `10000` | ZTS exchange timeout |
| `KUBERNETES_IDENTITY_SECRET_NAME` | Required when identity refresh is enabled | Published certificate/key Secret |
| `POD_NAME` | Required when identity refresh is enabled | ZTS instance ID source |
| `POD_NAMESPACE` | Required when identity refresh is enabled | Namespace of the published Secret |

Hub-managed deployments set the audience to `mcp-hub.mcps.<project>`, require `mcp-hub.mcps.<project>:role.accessor`, and mount the Athenz CA from the project-local `mcp-runtime-proxy-athenz-ca` ConfigMap. MCP Hub idempotently refreshes that ConfigMap from its configured Athenz CA when a Hub-managed server is created or updated.

The incoming path and query string are appended to `MCP_TARGET_URL`. For example, `/mcp` is forwarded to `http://127.0.0.1:8080/mcp` with request and response streaming preserved.

Health endpoints are available at `GET /healthz` and `GET /readyz`.

## Run checks

```sh
make check test
```

## Build the image

```sh
make build-image
```

CI publishes `ghcr.io/mlajkim/mcp-runtime-proxy:latest` from the main branch.
