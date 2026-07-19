# athenzd

`athenzd` is currently a CLI for browser login, idempotent ZMS service registration, and opt-in Copper Argos X.509 enrollment. It is not yet a long-running daemon and does not exchange access tokens, run a proxy, or rotate credentials.

# Current behavior

`athenzd login` performs two required operations and one optional operation:

1. Runs the OAuth 2.0 Authorization Code flow with PKCE, receives an ID token, and caches it locally.
2. Reads `preferred_username` from that token and ensures the configured Athenz service exists in ZMS.
3. When `identity.mode` is `copperargos`, generates a private key and CSR, submits the ID token to the configured ZTS instance provider as attestation, and writes the issued service certificate and signer CA.

With the default service template, a user whose token contains `preferred_username: alice` gets this target:

```text
home.alice.local.athenzd
```

The command:

- requires `home.alice` to already exist;
- creates `home.alice.local` when absent;
- adds each configured `optional_admins` principal to the child domain's `admin` role;
- creates the simple service `athenzd` when absent;
- authorizes the configured instance provider for that service when Copper Argos is enabled; and
- leaves existing objects unchanged.

It never creates the reserved `home` top-level domain or the personal parent `home.<user>`.

# Requirements before running

## Workstation

- A system browser must be available. Browser opening uses `open` on macOS, `xdg-open` on Linux, and `rundll32` on Windows.
- The configured callback port must be available on localhost. The default is `8250`.
- The workstation must be able to resolve and reach the configured IdP and ZMS URLs.
- The workstation must be able to reach ZTS when certificate enrollment is enabled.
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
- The authenticated user must be authorized to manage a direct child beneath their personal home domain.
- Every principal listed in `optional_admins` must be accepted by ZMS as a role member. Omit the list when the signed-in user should be the only administrator.

## Athenz namespace

The namespace must exist before login:

- The reserved `home` top-level domain must already exist.
- `home.<preferred_username>` must already exist for the signing-in user.
- The signing-in user must have sufficient rights on that personal parent domain.
- The rendered service must be directly beneath that parent using this structure:

```text
home.<preferred_username>.<child-domain>.<service-name>
```

Both `<child-domain>` and `<service-name>` must be valid Athenz simple names. A service name cannot contain a period.

If the personal parent is absent, login stops with an error. `athenzd` does not attempt to provision it.

## ZTS and the instance provider

Copper Argos enrollment requires independent Athenz server setup:

- ZTS must have the provider implementation on its classpath and the provider's Java properties configured.
- The provider service named by `athenz.provider` must exist and have a `class://...` provider endpoint.
- The provider must be authorized to launch Athenz instances globally and for the target service.
- The ID token issuer, audience, username claim, and JWKS URI accepted by the provider must match the token issued during login.

The local-workload provider intentionally disables certificate refresh. A later `athenzd login` performs a new attested registration and replaces the configured local key and certificate files.

# Install from source

Go 1.25 or later is required by the current module.

```sh
go install ./cmd/athenzd
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

A minimal current configuration looks like this:

```yaml
athenz:
  zts: https://zts.example.com:4443/zts/v1
  zms: https://zms.example.com:4443/zms/v1
  ca_file: /path/to/athenz-ca.pem

current_service: alice

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
✓ Required parent exists: home.alice
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

Running login again is safe. It obtains a fresh ID token, verifies or recreates only missing child resources, and requests a new certificate when Copper Argos is enabled.

# Cached identity

ID tokens are stored at:

```text
~/.cache/athenzd/<current_service>.json
```

The cache file is written with owner-only permissions. Treat it as a bearer credential.

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
athenzd whoami
```

`config` may also be abbreviated as `cfg`.

# Current limitations

- IdP endpoint construction currently assumes Keycloak-compatible paths.
- Only `preferred_username` is exposed to the service template.
- Optional administrators are added to the child domain but are never removed by login.
- Copper Argos is the only supported certificate-enrollment mode, and enrollment currently uses an RSA 2048-bit key with Athenz-compatible SPIFFE and instance-ID URI SANs.
- There is no automatic certificate rotation, logout, ZMS cleanup, token exchange, proxy, or daemon loop yet.

# Development

Run the full test and coverage checks:

```sh
make test
```

Build and install the current command:

```sh
make build
```
