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

### Showing the running Athenz versions

Run this from the IDTHW or internal context repository root to display the current ZMS and ZTS builds. It requires `kubectl` and an existing installation in namespace `athenz` of the current Kubernetes context:

```sh
make athenzv
```

```sh
# Captured on 2026-10-16 (terminal colors omitted)
# ▶ Athenz versions
#   ·  Context: kind-kind  Namespace: athenz
#
#   ✔  ZMS  1.12.48
#      Tag   v1.12.48
#      Pod   athenz-zms-server-7479684c78-sxd6d
#
#   ✔  ZTS  1.12.48
#      Tag   v1.12.48
#      Pod   athenz-zts-server-7f4885c9d7-l8hp8
```

The command uses `athenz-version-verifier.sh --show [namespace]` to read only the named `VERSION` and `VCS_REF` build metadata from each ready server container. Release images record a source tag such as `v1.12.48`, displayed as `Tag`. Custom builds show the recorded source commit as `SHA`, with any build suffix shown separately, including `dirty` markers. Both formats are valid and return success. It reports every active server pod, skips terminating pods, and returns exit code `2` if a component is missing, a pod is not ready, or build metadata is missing or unsupported. It does not change deployments or SQL.

### Switching the local Athenz version

Run these commands from the IDTHW repository root. Prerequisites are Python 3.10+, `make`, `gh`, `kubectl`, a running Docker daemon, `kind`, an initialized `athenz_dist` submodule, and an existing IDTHW installation in the current `kind-*` context. The helper targets namespace `athenz`, requires one replica per installed Athenz deployment, and uses the local DB container's passwordless root socket through `mariadb --no-defaults`. If the DB requires authentication, it stops; configure a separate migration workflow for that installation.

Image preparation uses the distribution's existing `load-docker-images-internal` target with `VERSION=<version>` and `ATHENZ_IMAGE_TAG=v<version>`, followed by `kubernetes/Makefile`'s `kind-load-images-internal`. The final rollout patches only application deployments: the distribution's normal `deploy-kubernetes-athenz` target also applies the DB workload, which is unsuitable for preserving the existing DB pod while changing the shared image tag.

`make athenz-vup` defaults to the highest stable `vX.Y.Z` tag in `AthenZ/athenz`. It checks all tag pages, compares versions numerically, and skips prerelease tags. The resolved version is printed and used for both SQL schemas and versioned images throughout the run. `VERSION=latest` explicitly selects this behavior.

Preview the latest release against the actual installed SQL schema. This also works when the current servers use custom builds or `latest` image tags:

```sh
make athenz-vup DRY_RUN=true
```

```sh
# Captured on 2026-10-16 (excerpt; the full output also lists images and SQL)
# · Latest stable Athenz tag: v1.12.49
# · SQL changes: 4; existing DB pod and data are retained
# ✔ Dry run complete; no images pulled, SQL applied or deployments changed
```

Switch to the latest stable tag:

```sh
make athenz-vup
```

```sh
# Expected final line if the resolved tag is v1.12.49; a live switch was not executed
# ✔ Athenz 1.12.49 is running; the existing database was preserved
```

Select a specific release instead:

```sh
make athenz-vup VERSION=1.12.48
```

```sh
# Expected final line after a successful rollout; a live switch was not run for the captured preview
# ✔ Athenz 1.12.48 is running; the existing database was preserved
```

To rebuild through the distribution's existing `build` target, add `REBUILD=true`. This requires its usual source-build prerequisites, including Git, Maven and a compatible JDK:

```sh
make athenz-vup VERSION=1.12.48 REBUILD=true
```

```sh
# Expected progress and final lines (excerpt; a rebuild was not executed for the preview)
# · Rebuilding with athenz_dist: build (isolated temporary checkout)
# ✔ Athenz 1.12.48 is running; the existing database was preserved
```

Rebuilds use temporary checkouts of the distribution's current commit and the requested Athenz release. This keeps the distribution's build overlays from accumulating across version changes and preserves local source edits. Uncommitted distribution edits are not included. Images are built locally with pushing disabled, and the temporary checkouts are cleaned up afterward. The existing DB image may be built or loaded into kind, but the running DB is not replaced.

`VERSION=v1.12.48` also works. `make athenz-version` and `make athenz-verison` remain aliases. When IDTHW is checked out as `idthw/` in the internal context repository, its root Makefile forwards `make athenz-vup` and the same variables here, including the default to the latest stable tag. The underlying entry point is `tools/athenz/set-athenz-version.sh <version|latest> [--dry-run] [--rebuild]`. `DRY_RUN=true REBUILD=true` previews the build path without checking out or building source.

The helper:

- Reads only SQL schema metadata and compares it with the ZMS/ZTS schema files at the requested upstream release tag
- Adds missing tables, columns with safe defaults or nullable columns, and nonunique indexes; widens VARCHAR columns while preserving their character set and collation
- Retains wider columns and compatible extra columns/indexes when selecting an older release; rejects incompatible types, defaults, required columns, unique keys and foreign keys for manual migration
- Prepares and loads images through `athenz_dist`'s Make targets, checks the application images' version labels, and completes image preparation before applying SQL
- Patches installed deployments and their matching Athenz init-container images, preserving other configuration and plugins; CLI/UI deployments are optional
- Preserves the current ZMS signing key IDs across its pod rename, then waits for each rollout and verifies the exact running ZMS/ZTS build versions

The DB StatefulSet, pod, running image and volumes are never patched or restarted by this command. This matters because the distribution's default DB storage is `emptyDir`: replacing its pod would lose the data. The helper neither dumps database contents nor runs upstream initialization scripts. Switching back retains compatible extra fields; it does not restore an older data snapshot or remove data added after an upgrade. Existing source checkouts and local Kustomize files are not edited; applying those manifests later can restore their configured images.

Dry runs do not pull images or establish image availability. A missing image or an incompatible schema stops an actual switch before SQL/deployment changes. MariaDB DDL is not transactional: a SQL error can leave some compatible additions applied, and a rollout error can leave earlier components upgraded. The command stops, reports the error (and previous main images for a rollout failure), and can be rerun after fixing the cause; every run inspects the live schema again. It never drops columns, shrinks VARCHAR columns, deletes data, or automatically reverses SQL changes. Deployment readiness and build versions do not establish application/plugin compatibility; run the relevant tutorial flow after switching.

Run the schema, orchestration, and version-verifier tests without accessing Docker or Kubernetes:

```sh
make test-athenz-version
```

```sh
# Expected unittest summary
# Ran 46 tests
# OK
```

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
./tools/athenz/athenz-version-verifier.sh <minimum-version> [zts|zms] [namespace]
./tools/athenz/athenz-version-verifier.sh --less-or-equal <maximum-version> [zts|zms] [namespace]
./tools/athenz/sign-rfc7523-assertion.sh --principal <domain.service> --private-key <path> --key-id <id> [--audience <zts-issuer>] [--scope <athenz-scope>] [--expires-in <seconds>]
./tools/athenz/fetch-access-token-with-rfc7523.sh <jwt_assertion|-> [scope] [--mode <jwt-bearer|client-assertion>] [--expect <200|400> [expected-error-text]]
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

`athenz-version-verifier.sh 1.12.48` requires the running ZTS version to be `1.12.48` or newer. It reads the distribution's build `VERSION` from every ready server container through `kubectl`, including images tagged `latest`, and prints a result for each pod using the shared `·`, `✔`, and `✘` status helpers. It compares numeric version components and treats a prerelease such as `1.12.48-SNAPSHOT` as older than `1.12.48`. Exit codes are `0` when the requirement is met, `1` for a version outside the requested limit, and `2` when the version cannot be verified. The optional component defaults to `zts` and namespace to `athenz`; use `./tools/athenz/athenz-version-verifier.sh 1.12.48 zms` to check ZMS. This checks reported build metadata; the feature's reproduction steps establish its behavior.

Use `--less-or-equal` to require a version at or below a release. This example shows expected output for a final `1.12.47` build:

```sh
./tools/athenz/athenz-version-verifier.sh --less-or-equal 1.12.47
```

```sh
#   ·  Checking Athenz ZTS version (maximum: 1.12.47, namespace: athenz)...
#   ✔  <zts-pod>: 1.12.47 is at or below the maximum 1.12.47
#   ✔  Athenz ZTS version check passed
```

`--LESS-OR-EQUAL` is an alias. This maximum also accepts `1.12.47-SNAPSHOT`; it rejects `1.12.48`, `1.12.48-SNAPSHOT`, and `1.12.100` with exit code `1`. Build metadata after `+` does not affect ordering. The [v1.12.47 comparison lab](../research/athenz/rfc7523-jwt-bearer/261010-jwt-client-assertion-audience-validation.md) checks this limit first and selects v1.12.47 if the running version is newer. Unknown versions and unavailable pods return exit code `2`; resolve those errors before setup.

When a version is below the minimum in namespace `athenz`, the verifier suggests `make athenz-vup VERSION=<minimum>` or `make athenz-vup` for the latest stable tag. These commands work from either the IDTHW or internal context repository root for the local kind installation. Add `DRY_RUN=true` to preview the SQL and rollout plan.

`get-id-token.sh` writes only the raw token to stdout so it can be used in command substitution. Status lines and decoded JWT header/claims are printed to stderr for inspection.

`fetch-access-token.sh` exchanges a Keycloak authorization code using its PKCE verifier, prints the response and decoded identifying claims to stderr, and writes only the raw access token to stdout for command substitution.

`fetch-access-token-with-cimd.sh` completes the configured CIMD Authorization Code flow: it starts a one-use callback listener, generates PKCE and state, opens Keycloak, validates the callback, exchanges the code, and writes only the raw access token to stdout. Use `--client-id <client_id>` to select the client explicitly. Use `--open <client_id>` to open an authorization request and exit without waiting for a callback or token; this is useful for inspecting rejected CIMD requests in the browser.

`get-client.sh` lists all clients as formatted JSON when called without an argument. When a `client_id` is provided, it returns only the exact `clientId` match as an array; a missing client returns `[]`.

`get-openid-configuration.sh` fetches the running Keycloak realm's live OpenID Connect discovery document and prints formatted JSON. Unlike `config.sh`, it does not read static tutorial configuration.

`set-cimd-client-profile.sh` idempotently configures the realm-level Client Profile used by the local CIMD research while preserving unrelated profiles.

`set-cimd-client-policy.sh` idempotently configures the realm-level Client Policy that activates the local CIMD profile for the trusted metadata host while preserving unrelated policies.

`sign-rfc7523-assertion.sh` creates and signs an RS256 assertion locally using the service's private key. By default, it first reads the ZTS OpenID configuration at `https://localhost:<zts-port>/zts/v1/.well-known/openid-configuration`, using `port.sh zts`, and sets `aud` to the advertised `issuer`. It logs the discovery endpoint, complete metadata response, and resolved audience to stderr, and stops if discovery fails or the issuer is missing. Pass `--audience <zts-issuer>` to override discovery and sign offline. Omit `--scope` to leave the scope claim out of the JWT. It writes only the compact assertion to stdout so it can be piped into the fetch helper; status lines and formatted header/claims go to stderr.

`fetch-access-token-with-rfc7523.sh` sends the assertion to the local ZTS token endpoint and returns an access token. Pass `-` as the first argument to read the assertion from stdin. Its optional second argument sends an HTTP `scope` parameter, allowing the JWT itself to omit the scope claim; when this argument is omitted in the default `jwt-bearer` mode, ZTS uses the JWT's scope. The original single-assertion argument remains supported. Use `--mode client-assertion` with an explicit HTTP scope for JWT client authentication with `grant_type=client_credentials`. Both modes work without a client certificate.

The fetch helper prints the endpoint, grant type, scope source, HTTP status, all response fields with credential values redacted, and the complete decoded access-token header and claims to stderr. Only the raw access token goes to stdout for piping or command substitution. It requires HTTP `200` and a non-empty Bearer JWT access token by default; unexpected HTTP errors, invalid responses, and transport failures exit nonzero after diagnostics.

For research checks, add `--expect 200` or `--expect 400 'expected error text'` to the same fetch command. Expected `200` requires a Bearer access token; expected `400` requires error code `400`, no access token, and the supplied error-message fragment. A matching rejection exits successfully with empty stdout; a mismatch exits nonzero. These options only check the response and do not change the HTTP request.

Both the [v1.12.47 comparison](../research/athenz/rfc7523-jwt-bearer/261010-jwt-client-assertion-audience-validation.md) and [v1.12.48 validation](../research/athenz/rfc7523-jwt-bearer/261011-jwt-client-assertion-audience-validation.md) use the signing and fetch helpers directly.

Run the helper tests with mocked HTTP responses:

```sh
python3 -m unittest discover -s tools/athenz/tests -p 'test_jwt_assertion.py'
```

```sh
# Expected unittest summary
# Ran 20 tests
# OK
```

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
