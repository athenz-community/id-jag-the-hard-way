# Tools

This directory contains list of helper scripts for running the ID-JAG The Hard Way tutorial locally.

## Scripts

### `keep-k8s-port-forward.sh`

Keeps all service ports forwarded from Kubernetes to `localhost`. Run this once in a dedicated terminal while following the tutorials.

```sh
./tools/keep-k8s-port-forward.sh
```

**Behavior:**
- Reads port assignments from `config.yaml` (or `config.local.yaml` if present)
- If a port is already in use, prompts you to enter a different one — the choice is saved to `config.local.yaml`
- If a port is still busy after waiting, offers to kill the blocking process
- Detects if another instance is already running and asks whether to replace it
- On exit (Ctrl+C), kills all child `kubectl port-forward` processes cleanly

---

### `port.sh`

Prints the effective port for a given service. Reads `config.local.yaml` first, falls back to `config.yaml`.

```sh
./tools/port.sh <service>
```

**Examples:**
```sh
./tools/port.sh open-webui      # → 54443
./tools/port.sh keycloak        # → 34443
./tools/port.sh keycloak-https  # → 34444
./tools/port.sh agentgateway    # → 44440
./tools/port.sh agentgateway-admin # → 44441
./tools/port.sh mcp-gateway         # → 24445
./tools/port.sh genai-proxy          # → 64443
./tools/port.sh athenzd-genai-proxy  # → 65443
```

Used inside other scripts and tutorials to avoid hardcoded port numbers.

---

### `open.sh`

Opens a URL in the system browser. Works on macOS, Linux, and Windows. Supports incognito/private mode.

```sh
./tools/open.sh <url> [incognito=true]
```

**Examples:**
```sh
./tools/open.sh "http://localhost:3000"
./tools/open.sh "http://localhost:54443" incognito=true
```

Browser priority for incognito: Chrome → Firefox → Safari/Edge (platform-dependent).

### Identity and token helpers

Use these from tutorials and research setup steps instead of repeating low-level HTTP commands.

```sh
./tools/keycloak/create-client.sh <client_id> <redirect_uri> [web_origin] [public|confidential]
./tools/keycloak/delete-client.sh <client_id>
./tools/keycloak/fetch-access-token.sh <authorization_code> <code_verifier>
./tools/keycloak/fetch-access-token-with-cimd.sh [--client-id <client_id> | --open <client_id>]
./tools/keycloak/get-client-secret.sh <client_id>
./tools/keycloak/get-client.sh [client_id]
./tools/keycloak/get-id-token.sh <client_id> <client_secret> [username]
./tools/keycloak/get-openid-configuration.sh
./tools/keycloak/set-cimd-client-profile.sh
./tools/keycloak/set-cimd-client-policy.sh
./tools/keycloak/set-direct-access-grants.sh <client_id> [true|false]
./tools/athenz/create-role.sh <domain> <role> [--self-renew] [--self-renew-mins <minutes>]
./tools/athenz/create-group.sh <domain> <group> [--self-renew] [--self-renew-mins <minutes>]
./tools/athenz/create-rfc7523-assertion.sh --principal <domain.service> --private-key <path> --key-id <id> --audience <zts-issuer> --scope <athenz-scope> [--expires-in <seconds>]
./tools/athenz/fetch-access-token-with-rfc7523.sh <jwt_assertion>
./tools/athenz/fetch-access-token.sh <cert_path> <key_path> <scope> [output_file] [--actor <actor>] [--output <output_file>]
./tools/athenz/fetch-access-token-with-id-jag.sh <cert_path> <key_path> <id_jag_token> <scope> [output_file] [--actor <actor>] [--output <output_file>]
./tools/athenz/fetch-id-jag.sh <cert_path> <key_path> <id_token> <scope>
./tools/athenz/exchange-id-token-for-id-jag.sh <cert_path> <key_path> <id_token> <scope> [--audience <audience>] [--token-only]
./tools/athenz/fetch-actor-token.sh <cert_path> <key_path> <client_id>
./tools/athenz/exchange-access-token.sh <cert_path> <key_path> <subject_access_token> <scope> [--actor-token <id_token>] [--actor <actor>] [--audience <audience>] [--token-only]
./tools/athenz/delete-policy.sh <domain> <policy>
./tools/athenz/delete-group.sh <domain> <group>
./tools/athenz/delete-role.sh <domain> <role>
./tools/athenz/delete-role-member.sh <domain> <role_name> <member_name>
./tools/athenz/delete-service.sh <domain> <service_name>
./tools/athenz/show-domain.sh <domain>
./tools/athenz/show-service.sh <domain> <service_name> [--summary]
./tools/athenz/set-service-client-id.sh <domain> <service_name> <client_id>
```

`create-role.sh` and `create-group.sh` keep their original two-argument behavior. Use `--self-renew` to enable membership self-renewal when creating the object and `--self-renew-mins <minutes>` to set its renewal duration. ZMS requires a positive duration whenever self-renewal is enabled.

`get-id-token.sh` writes only the raw token to stdout so it can be used in command substitution. Status lines and decoded JWT header/claims are printed to stderr for inspection.

`fetch-access-token.sh` exchanges a Keycloak authorization code using its PKCE verifier, prints the response and decoded identifying claims to stderr, and writes only the raw access token to stdout for command substitution.

`fetch-access-token-with-cimd.sh` completes the configured CIMD Authorization Code flow: it starts a one-use callback listener, generates PKCE and state, opens Keycloak, validates the callback, exchanges the code, and writes only the raw access token to stdout. Use `--client-id <client_id>` to select the client explicitly. Use `--open <client_id>` to open an authorization request and exit without waiting for a callback or token; this is useful for inspecting rejected CIMD requests in the browser.

`get-client.sh` lists all clients as formatted JSON when called without an argument. When a `client_id` is provided, it returns only the exact `clientId` match as an array; a missing client returns `[]`.

`get-openid-configuration.sh` fetches the running Keycloak realm's live OpenID Connect discovery document and prints formatted JSON. Unlike `config.sh`, it does not read static tutorial configuration.

`set-cimd-client-profile.sh` idempotently configures the realm-level Client Profile used by the local CIMD research while preserving unrelated profiles.

`set-cimd-client-policy.sh` idempotently configures the realm-level Client Policy that activates the local CIMD profile for the trusted metadata host while preserving unrelated policies.

`create-rfc7523-assertion.sh` creates an RS256 service-signed JWT authorization grant. It writes only the compact assertion to stdout so it can be passed to the ZTS RFC 7523 token request; status lines and formatted header/claims go to stderr.

`fetch-access-token-with-rfc7523.sh` exchanges that signed assertion through the RFC 7523 JWT bearer authorization grant. It displays the issued access token and its decoded header and claims on stderr, then writes only the raw access token to stdout for command substitution.

`set-direct-access-grants.sh` updates an existing Keycloak client so password-grant token fetching works for local research flows.

`exchange-access-token.sh` prints pretty JSON to stdout by default. With `--token-only`, it writes only the raw exchanged token to stdout so it can be used in command substitution. Status lines and decoded JWT header/claims are printed to stderr when a token is returned.

`fetch-access-token-with-id-jag.sh` supports `--actor` for delegated ID-JAG access-token requests that must mint a `may_act` token for a specific actor service.

`show-service.sh` reads service metadata via the ZMS HTTP API and prints pretty JSON by default, including `clientId` when it is stored in service metadata. Use `--summary` for compact `service`, `client-id`, and `public-key-ids` lines.

`create-client.sh` supports optional environment overrides:

- `KEYCLOAK_DIRECT_ACCESS_GRANTS=true` enables password-grant token fetching for local research flows.
- `KEYCLOAK_CLIENT_SECRET=<secret>` sets a deterministic secret for confidential clients.
- `KEYCLOAK_OPEN_UI=false` skips opening the Keycloak admin UI after create/update.

`fetch-access-token.sh` keeps its original positional output-file argument. The named `--output` form is available for readability when combined with `--actor`.

## Configuration

### `config.yaml`

Default port assignments. **Do not edit this file.**

```yaml
ports:
  zms: 4443
  zts: 8443
  athenz-ui: 3000
  api-server: 14443
  core-mcp-proxy: 24442
  mcp: 24443
  confluence-mcp: 24444
  mcp-gateway: 24445
  keycloak: 34443
  keycloak-https: 34444
  agentgateway: 44440
  agentgateway-admin: 44441
  ai-client-gateway: 44443
  ai-client-gateway-codex: 44444
  open-webui: 54443
  genai-proxy: 64443
  athenzd-genai-proxy: 65443
```

### `config.local.yaml` _(gitignored)_

Your personal port overrides. Created automatically by `keep-k8s-port-forward.sh` when you choose a different port. You can also edit it manually.

```yaml
ports:
  open-webui: 55000   # example override
```

Values here take precedence over `config.yaml`.
