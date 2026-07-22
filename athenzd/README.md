# athenzd

`athenzd` is currently a manager CLI for browser login, idempotent ZMS service registration, opt-in Copper Argos X.509 enrollment, ID-JAG issuance for GenAI service projects, and selection of one active GenAI access-token scope. When `gen_ai.proxy` is configured, login ensures a separate directory-level `athenzd-genai-proxy` daemon is running and then exits normally. The daemon does not rotate credentials.

# Current behavior

`athenzd login` performs two required operations and up to three optional operations:

1. Runs the OAuth 2.0 Authorization Code flow with PKCE, receives an ID token, and caches it locally.
2. Reads `preferred_username` from that token and ensures the configured Athenz service exists in ZMS.
3. When `identity.mode` is `copperargos`, generates a private key and CSR, submits the ID token to the configured ZTS instance provider as attestation, and writes the issued service certificate and signer CA.
4. When both `gen_ai.domain` and `gen_ai.role` are configured, uses that X.509 identity to issue and cache one all-eligible-roles ID-JAG per associated service project, then issues one access token for the selected `gen_ai.default_project` using that project's baseline `gen_ai.role` scope.
5. When `gen_ai.proxy` is present, ensures the current config directory's detached local daemon is healthy on the configured workstation port. That daemon injects the latest active cached GenAI access token into requests forwarded to the protected GenAI proxy.

After login establishes that baseline access token, `athenzd set genai-project` refreshes the human and workload role memberships from ZMS, lets the user choose a currently eligible project and scope, and replaces the active cached access token.

With the default service template, a user whose token contains `preferred_username: alice` gets this target:

```text
home.alice.local.athenzd
```

The command:

- creates the personal home domain `home.alice` through ZMS's dedicated user-domain API when absent;
- creates `home.alice.local` when absent;
- adds each configured `optional_admins` principal to the child domain's `admin` role;
- creates the simple service `athenzd` when absent;
- authorizes the configured instance provider for that service when Copper Argos is enabled; and
- leaves existing objects unchanged.

It never creates or modifies the reserved `home` top-level domain. ZMS creates that namespace root during system bootstrap.

# Requirements before running

## Workstation

- A system browser must be available. Browser opening uses `open` on macOS, `xdg-open` on Linux, and `rundll32` on Windows.
- The configured callback port must be available on localhost. The default is `8250`.
- The workstation must be able to resolve and reach the configured IdP and ZMS URLs.
- The workstation must be able to reach ZTS when certificate enrollment is enabled.
- The configured GenAI injector port must be available when `gen_ai.proxy` is present. Its default is `65443`.
- Any private certificate authority used by the IdP, ZMS, or ZTS must be available as a PEM file.

## Identity provider

The IdP must be configured before `athenzd login` runs:

- It must expose Keycloak-compatible authorization and token endpoints beneath the configured issuer:
  - `<issuer>/protocol/openid-connect/auth`
  - `<issuer>/protocol/openid-connect/token`
- An OAuth client must exist for `athenzd`.
- Authorization Code flow and PKCE with `S256` must be enabled.
- The client must allow `http://localhost:<callback_port>/callback` as a redirect URI.
- The `openid` scope must return an ID token.
- The ID token must contain a non-empty `preferred_username` claim.
- `preferred_username` must be a valid Athenz simple name: letters, digits, `_`, and `-`, with the first character limited to a letter, digit, or `_`.
- The token issuer and audience must match the values accepted by ZMS.

`athenzd` obtains the ID token directly from the IdP token endpoint over TLS. It decodes the claims needed to derive the service identity; ZMS remains responsible for authenticating and validating the token used for ZMS requests.

## ZMS

ZMS must be prepared independently:

- The ZMS API must be reachable from the workstation.
- ZMS must accept the IdP ID token from the `Authorization: Bearer <id-token>` request header.
- The configured ZMS authority must validate the token signature, issuer, audience, freshness, and signing key.
- The authority must map `preferred_username` to the corresponding Athenz user principal, such as `user.alice`.
- ZMS must trust the IdP signing-key endpoint when that endpoint uses a private CA.
- ZMS must allow user-domain creation, and the authenticated user must be authorized to create and manage their own personal home domain.
- Every principal listed in `optional_admins` must be accepted by ZMS as a role member. Omit the list when the signed-in user should be the only administrator.

For GenAI project discovery, ZMS must also return the human's role memberships from `GET /role?principal=user.<preferred_username>&expand=true`. For the local workload, `athenzd` combines that principal-role lookup with the project's domain membership listing so Athenz suffix-wildcard members such as `home.*` are included.

## GenAI service projects

Each matching Athenz domain acts like a service-project group. For example, this convention:

```yaml
gen_ai:
  domain: gen-ai.services.{{project}}
  role: gen-ai-users
  default_project: athenz
  proxy:
    port: 65443
    upstream_url: http://127.0.0.1:64443
```

maps `gen-ai.services.athenz` to service key `athenz` and `gen-ai.services.mail` to service key `mail`. A signed-in user may be a `gen-ai-users` member in both projects.

The two Athenz principals remain distinct throughout this flow. The ID token's `preferred_username` identifies the delegated human as `user.<preferred_username>`. The Copper Argos certificate identifies the exchanging workload as `home.<preferred_username>.local.athenzd`; it does not replace the human subject.

Within each matching project, `athenzd` computes the intersection of:

- every role held by the signed-in user; and
- every `<role>-jag-exchangers` role held by the local X.509 workload.

The configured baseline role must be present on both sides: the user must hold `<domain>:role.<gen_ai.role>`, and the workload must hold `<domain>:role.<gen_ai.role>-jag-exchangers`, either through exact/expanded membership or an applicable Athenz suffix wildcard. `home.*` is a valid broad grant for the local demo; an infix pattern such as `home.*.local.athenzd` is not valid Athenz syntax. Each `<role>-jag-exchangers` role must have a policy granting `zts.jag_exchange` on its corresponding target role. The workload's Athenz service metadata must also set `clientId` to the ID token audience, normally the configured `idp.client_id`.

Roles from different project domains are never combined. Current ZTS scope parsing accepts only one role domain per ID-JAG, so a user associated with two services receives two independently scoped tokens.

For example, if `user.alice` holds `gen-ai-users` and `docs-reader` in the Athenz project, while `home.alice.local.athenzd` holds the matching `gen-ai-users-jag-exchangers` and `docs-reader-jag-exchangers` roles, the Athenz-project ID-JAG contains both target scopes. A separate Mail-project membership produces a separate Mail-project ID-JAG.

## Athenz namespace

The namespace root must exist before login:

- The reserved `home` top-level domain must already exist.
- ZMS must support `POST /userdomain/<preferred_username>` for the signing-in user. This creates `home.<preferred_username>` and makes that user its administrator.
- The rendered service must be directly beneath that parent using this structure:

```text
home.<preferred_username>.<child-domain>.<service-name>
```

Both `<child-domain>` and `<service-name>` must be valid Athenz simple names. A service name cannot contain a period.

If the personal parent is absent, `athenzd` creates it through the user-domain API before creating the child domain. Login stops if ZMS has user domains disabled or rejects that request. `athenzd` never calls the top-level-domain creation API.

## ZTS and the instance provider

Copper Argos enrollment requires independent Athenz server setup:

- ZTS must have the provider implementation on its classpath and the provider's Java properties configured.
- The provider service named by `athenz.provider` must exist and have a `class://...` provider endpoint.
- The provider must be authorized to launch Athenz instances globally and for the target service.
- The ID token issuer, audience, username claim, and JWKS URI accepted by the provider must match the token issued during login.

The local-workload provider intentionally disables certificate refresh. A later `athenzd login` performs a new attested registration and replaces the configured local key and certificate files.

ID-JAG issuance additionally requires ZTS to load a token-exchange identity provider for the ID token issuer. That provider must validate the token and map its subject to the same Athenz user whose roles ZMS discovered.

# Install from source

Go 1.25 or later is required by the current module.

```sh
go install ./cmd/athenzd ./cmd/athenzd-genai-proxy
```

Confirm the installed binary is available:

```sh
athenzd version
```

# Configuration

Configuration is resolved in this order:

1. The explicit path passed with `-f`.
2. `.athenzd/config.yaml` in the current directory.
3. `~/.athenzd/config.yaml`.

A Copper Argos configuration with GenAI project discovery looks like this:

```yaml
athenz:
  zts: https://zts.example.com:4443/zts/v1
  zms: https://zms.example.com:4443/zms/v1
  ca_file: /path/to/athenz-ca.pem

current_service: alice

gen_ai:
  domain: gen-ai.services.{{project}}
  role: gen-ai-users
  default_project: athenz

services:
  - name: alice
    athenz:
      service: home.{{.preferred_username}}.local.athenzd
      optional_admins:
        - user.platform_admin
      provider: sys.auth.localworkload
    idp:
      issuer: https://idp.example.com/realms/example
      client_id: athenzd
      callback_port: 8250
      ca_file: /path/to/idp-ca.pem
    identity:
      mode: copperargos
      instance_id: alice-athenzd
      cert_file: ~/.config/athenzd/identity/alice.cert.pem
      key_file: ~/.config/athenzd/identity/alice.key.pem
      ca_file: ~/.config/athenzd/identity/ca.cert.pem
      expiry_minutes: 60
```

`current_service` selects a local profile and its token-cache filename. It is not an Athenz service identity.

Omit the entire `gen_ai` block to disable GenAI project discovery. Once `gen_ai` is present, `domain` and `role` are required; `default_project` and `proxy` are optional. `gen_ai.domain` must contain exactly one `{{project}}` placeholder; `{{.project}}` is accepted as an equivalent spelling. `gen_ai.role` is the simple baseline role name, not a fully qualified Athenz scope.

`gen_ai.default_project` is the project key represented by `{{project}}`, such as `athenz` or `mail`. After issuing the per-project ID-JAGs, login uses the selected project's ID-JAG to request one access token for the baseline role configured by `gen_ai.role`. For example, project `athenz` derives the scope `gen-ai.services.athenz:role.gen-ai-users`. If this setting is absent, an interactive arrow-key prompt lists only the eligible project names from the freshly issued ID-JAGs. The selected project is saved into the active config file: the explicit `-f` file, the current directory's `.athenzd/config.yaml`, or the user-level `~/.athenzd/config.yaml`.

Presence of `gen_ai.proxy` makes `athenzd login` manage a separate `athenzd-genai-proxy` process after it caches the default access token. The daemon instance belongs to the directory containing the resolved config file, normally the current project's `.athenzd/` directory. Login reuses that directory's healthy matching daemon or launches one, waits for its identifying `/healthz` response, records its PID and settings beside the config, and exits. The daemon listens on `0.0.0.0:<port>`, reloads the active cached token for every request, replaces any caller-supplied `Authorization` header, and forwards the request to `upstream_url`. Empty values use port `65443` and `http://127.0.0.1:64443`. This lets Open WebUI in the local kind cluster use `http://host.docker.internal:65443` with authentication disabled; the protected GenAI resource proxy on port `64443` still validates the injected AT and removes it before calling Ollama.

Each directory-level daemon has a non-secret identity derived from its config directory. If another project already owns the configured port, login fails instead of reusing that project's credentials. Give concurrently active projects different `gen_ai.proxy.port` values.

ID-JAG does not have a network port. Port `65443` belongs to the client-side `athenzd` injector, while port `64443` belongs to the GenAI resource proxy. Both listeners bind to the workstation for local container access, so use this setup only on a trusted development machine and do not expose either port to the internet.

`athenz.service` is the complete desired Athenz identity. It uses Go `text/template` syntax, matching the template family used by `kubectl -o go-template`. The currently supported dynamic field is:

```text
{{.preferred_username}}
```

Template rendering happens inside the Go binary and does not depend on Bash, zsh, or PowerShell substitution.

`optional_admins` is additive. The signed-in user is always included when the child domain is created. Each unique configured principal is added afterward if missing; omitting the list does not remove or replace the signed-in user.

`athenz.ca_file` is optional when the ZMS and ZTS certificates are trusted by the operating system. `idp.ca_file` is optional when the IdP certificate is trusted by the operating system.

`athenz.provider` identifies the provider used by ZTS authorization and the CSR instance-ID URI. `identity.instance_id` must be stable and unique within that provider's namespace. The three identity output paths must be different; `~` and `~/...` are expanded by `athenzd`. The private key is written with mode `0600`, while the certificate and signer CA use `0644`.

Omit the entire `identity` block for login and ZMS service setup without certificate enrollment. `copperargos` is the only identity mode currently supported.

A planned `local` mode will read an externally managed certificate, private key, and CA from the configured paths instead of using ID-token attestation or writing newly issued credentials. That mode is not implemented yet.

Validate the selected config before logging in:

```sh
athenzd config current-config
athenzd config validate
```

Use an explicit file when required:

```sh
athenzd config validate -f /path/to/config.yaml
```

# Login

```sh
athenzd login
```

With Copper Argos enabled, successful output ends with the issued identity and output paths:

```text
Step 2/3 — Ensure Athenz service home.alice.local.athenzd
✓ Personal home domain home.alice: already exists
✓ Local subdomain home.alice.local: already exists
✓ Optional administrator user.platform_admin: already present
✓ Service home.alice.local.athenzd: already exists

Step 3/3 — Enroll X.509 identity through sys.auth.localworkload
✓ Certificate issued: home.alice.local.athenzd (instance alice-athenzd)
✓ Certificate: ~/.config/athenzd/identity/alice.cert.pem
✓ Private key: ~/.config/athenzd/identity/alice.key.pem
✓ Signer CA: ~/.config/athenzd/identity/ca.cert.pem
✓ Ready: home.alice.local.athenzd
```

Running login again is safe. Login obtains a fresh ID token, verifies or recreates missing personal-domain and child resources, requests a new certificate when Copper Argos is enabled, replaces the cached per-project ID-JAGs when GenAI issuance is configured, and reuses the current directory's matching proxy daemon. It rejects a configured port owned by another service, another project directory, or a proxy targeting a different upstream.

# ID-JAG login step

With Copper Argos and GenAI configuration enabled, login continues with a fourth step after certificate enrollment:

```text
Step 4/4 — Issue ID-JAGs for all eligible GenAI service-project roles
✓ Eligible roles for user.alice:
  - gen-ai.services.athenz:role.docs-reader
  - gen-ai.services.athenz:role.gen-ai-users
  - gen-ai.services.mail:role.gen-ai-users
✓ gen-ai.services.athenz: ID-JAG issued with 2 scope(s): gen-ai.services.athenz:role.docs-reader gen-ai.services.athenz:role.gen-ai-users
✓ gen-ai.services.mail: ID-JAG issued with 1 scope(s): gen-ai.services.mail:role.gen-ai-users
✓ 2 ID-JAG(s) cached for current_service "alice"
✓ Default GenAI project: athenz
✓ Default access token issued and cached for project athenz with scope gen-ai.services.athenz:role.gen-ai-users

If you want to change the active GenAI project or scope later, run:
  athenzd set genai-project

✓ athenzd GenAI proxy daemon started on port 65443 (PID 12345)
  Open WebUI: http://host.docker.internal:65443 (Auth disabled)
  Upstream: http://127.0.0.1:64443
  Project config: /workspace/my-project/.athenzd/config.yaml
  Log: /workspace/my-project/.athenzd/genai-proxy.log
```

Login exits after the daemon becomes healthy. In Open WebUI, add an external Ollama connection using URL `http://host.docker.internal:65443`, leave Auth disabled, and leave Model IDs empty. Open WebUI never receives or stores the Athenz AT.

The daemon reloads `~/.cache/athenzd/<current_service>.json` for every request. Its directory-level runtime files are `.athenzd/genai-proxy.log` and `.athenzd/genai-proxy-state.json` beside the active project config. Run `athenzd set genai-project` to change the project or scope without restarting it. If the active access token expires, requests receive HTTP 401 with instructions to refresh the project or log in again.

The cache stores a JSON object keyed by service project:

```json
{
  "id_token": "<ID token>",
  "expires_at": "2026-07-19T16:00:00+09:00",
  "id_jags": {
    "athenz": {
      "service": "athenz",
      "domain": "gen-ai.services.athenz",
      "token": "<ID-JAG>",
      "scope": "gen-ai.services.athenz:role.docs-reader gen-ai.services.athenz:role.gen-ai-users",
      "expires_at": "2026-07-19T15:00:00+09:00"
    },
    "mail": {
      "service": "mail",
      "domain": "gen-ai.services.mail",
      "token": "<ID-JAG>",
      "scope": "gen-ai.services.mail:role.gen-ai-users",
      "expires_at": "2026-07-19T15:00:00+09:00"
    }
  },
  "access_token": {
    "project": "athenz",
    "scope": "gen-ai.services.athenz:role.gen-ai-users",
    "token": "<Athenz access token>",
    "token_type": "Bearer",
    "expires_at": "2026-07-19T14:00:00+09:00"
  }
}
```

Login prints the user's eligible project roles before attempting the ZTS exchanges, then prints successful issuance details. This keeps the discovered role associations visible even when an exchange fails. It never prints raw ID-JAG or access-token values.

ID-JAG and access-token issuance are best-effort when the injector is disabled. If no project is eligible, login logs a friendly message such as `↷ ID-JAG skipped — no eligible GenAI roles found for user.alice`. Discovery, exchange, prompt, config-save, or cache failures are also logged as skipped, and login still succeeds with the cached ID token and enrolled X.509 identity. When `gen_ai.proxy` is present, login instead returns an error if it could not issue the default AT because the injector must not start without a credential.

# Change the active GenAI project or scope

Run this after login whenever the active access token should use another eligible project or role:

```sh
athenzd set genai-project
```

The command does not trust the ID-JAG roles already in the cache. It uses the cached, unexpired ID token to query ZMS again for the human's current role memberships and the local workload's current matching `-jag-exchangers` memberships, then issues fresh per-project ID-JAGs from their intersection. The prompts contain only the projects and scopes eligible at that moment.

Choose a project first. When that project has exactly one eligible scope, `athenzd` uses it immediately without showing a redundant scope prompt; when it has multiple scopes, choose one in a second prompt. Focused choices and the login command hint use the Athenz blue `#215af2`. After selection, `athenzd` narrows the freshly issued project ID-JAG into a one-scope access token, replaces the cached ID-JAGs and access token, and saves the selected project as `gen_ai.default_project` in the active config file.

The chosen non-baseline scope is an active-session choice stored in the token cache, not a new static authorization grant. A later `athenzd login` starts from the configured baseline `gen_ai.role` again and prints the command reminder so the user can make another current-role selection. If the cached ID token is expired, the command asks the user to run `athenzd login` again.

# Cached identity

ID tokens are stored at:

```text
~/.cache/athenzd/<current_service>.json
```

The cache file is written with owner-only permissions. It contains the ID token, issued per-project ID-JAGs, and the default access token; treat it as bearer-credential material.

Inspect its non-secret identity fields without printing the token:

```sh
athenzd whoami
```

# Commands

```text
athenzd version
athenzd config current-config
athenzd config validate
athenzd login
athenzd set genai-project
athenzd whoami
```

`config` may also be abbreviated as `cfg`.

# Idempotency

Normal `athenzd` commands are designed to converge safely when repeated. `config` and `whoami` commands are read-only. `athenzd login` ensures missing Athenz resources without duplicating existing ones and reuses the current project's healthy proxy daemon instead of launching another. If the recorded daemon has stopped, the next login starts one replacement and overwrites its stale state. `athenzd set genai-project` refreshes current authorization data but does not rewrite the config when the selected default project is already set.

Credential issuance is the intentional exception: login and project selection may issue fresh ID tokens, certificates, ID-JAGs, or access tokens because those credentials expire. Repetition preserves the same desired configuration while refreshing time-bound credentials. A port owned by another service or project is reported as an error and is never stopped or replaced automatically.

# Current limitations

- IdP endpoint construction currently assumes Keycloak-compatible paths.
- Only `preferred_username` is exposed to the service template.
- Optional administrators are added to the child domain but are never removed by login.
- Copper Argos is the only supported certificate-enrollment mode, and enrollment currently uses an RSA 2048-bit key with Athenz-compatible SPIFFE and instance-ID URI SANs.
- There is no automatic certificate rotation, token renewal, logout, ZMS cleanup, or proxy stop/restart command yet. Login can ensure the detached GenAI proxy is running, and the daemon reloads cache changes without restart.

# Package boundaries

ID-JAG support is split into focused modules:

- `internal/genai` validates the domain/role convention and maps exchanger roles to target scopes.
- `internal/zms` discovers user and workload memberships.
- `internal/zts` performs the mTLS OAuth token exchange and validates the returned token scopes.
- `internal/idjag` coordinates one exchange per project without knowing about CLI config, output, or cache files.
- `internal/accesstoken` separately coordinates narrowing one ID-JAG into one role access token.
- `internal/genaiproxy` provides the directory-level daemon lifecycle and streams local client requests to the configured GenAI resource proxy after injecting the latest active cached access token.
- `cmd/athenzd` is the manager CLI; it handles configuration, credentials, persistence, and daemon health checks but never serves proxy traffic.
- `cmd/athenzd-genai-proxy` is the separately installed request-serving daemon managed by `athenzd`.

# Development

Run the full test and coverage checks:

```sh
make test
```

Build and install the current command:

```sh
make build
```
