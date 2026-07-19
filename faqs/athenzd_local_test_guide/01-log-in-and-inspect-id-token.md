# Goal

The goal of this guide is to run `athenzd login` against the local Keycloak IdP from this repo over HTTPS, cache a real ID token for the Keycloak user `idjag-learner`, and inspect its claims to confirm the token is valid, with the following steps:

<!-- TOC depthFrom:2 depthTo:3 -->

- [Step 1. Build and install `athenzd`](#step-1-build-and-install-athenzd)
- [Step 2. Create the `athenzd` Keycloak client](#step-2-create-the-athenzd-keycloak-client)
- [Step 3. Map the Keycloak hostname on the workstation](#step-3-map-the-keycloak-hostname-on-the-workstation)
- [Step 4. Generate the athenzd config](#step-4-generate-the-athenzd-config)
- [Step 5. Run `athenzd login`](#step-5-run-athenzd-login)
- [Step 6. Inspect the cached ID token](#step-6-inspect-the-cached-id-token)

<!-- /TOC -->

<details>
<summary>Last verified on 2026-07-19 — ✅ Success</summary>

| # | Date | Status                                              |
|---|------|-----------------------------------------------------|
| 1 | 2026-07-19 | ✅ Success — human confirmed this procedure |

</details>

> [!NOTE]
> This guide only produces and inspects an ID token. It does not fetch an X.509 certificate or exchange the token for an Athenz access token. The ID token is the raw material for the later ID-JAG exchange.

# Prerequisites

- Complete the main tutorial through [Identity Provider](../../tutorials/13-identity-provider.md) and leave `./tools/keep-k8s-port-forward.sh` running. Completing this prerequisite means the tutorial's local service endpoints remain port-forwarded to the workstation.
- Complete [Make Keycloak HTTPS for ZTS User Certificates](../make-keycloak-https.md).

# Steps

## Step 1. Build and install `athenzd`

Build the `athenzd` binary and install it onto your `PATH`:

```sh
make -C athenzd build
```

```sh
# go install ./cmd/athenzd
# Installed: /Users/you/go/bin/athenzd
```

Confirm the binary runs:

```sh
athenzd version
```

```sh
# athenzd v0.0.0
```

> [!NOTE]
> `athenzd` reads its config relative to the current directory (`./.athenzd/config.yaml` for the project-level config). Commands that load config — like `athenzd login` below — are run as `(cd athenzd && ...)` so the generated project config is always picked up. Commands that don't read config, like `athenzd version`, run from anywhere.

## Step 2. Create the `athenzd` Keycloak client

`athenzd login` uses the browser Authorization Code flow with PKCE, so the Keycloak client must be **public** (no secret) and must whitelist the local callback redirect URI. The callback runs on `http://localhost:8250/callback`.

This is one shared client for the whole tool — every user signs in through the same `athenzd` client, and Keycloak still authenticates each person separately. You do not create a client per user.

```sh
./tools/keycloak/create-client.sh \
  "athenzd" \
  "http://localhost:8250/callback" \
  "http://localhost:8250" \
  public
```

```sh
  # ·  Fetching Keycloak admin token...
  # ·  Looking up client athenzd in realm master...
  # ·  Creating client athenzd...
  # ✔  Client created: athenzd
  # ✔  Opened: http://localhost:34443/admin/master/console/#/master/clients/<uuid>/settings
```

The helper sets the client values this flow needs:

- `publicClient: true`: no client secret is required, which is correct for a CLI that cannot keep a secret.
- `standardFlowEnabled: true`: enables the browser Authorization Code flow that PKCE builds on.
- `redirectUris`: allows Keycloak to redirect back to `http://localhost:8250/callback`.
- `webOrigins`: allows the local callback origin.

## Step 3. Map the Keycloak hostname on the workstation

Keycloak runs in Kubernetes as `keycloak.idp`, while the HTTPS listener is exposed to the workstation through the local port-forward. Add an idempotent `/etc/hosts` entry so the same hostname resolves to the port-forward on the workstation:

```sh
if ! awk '$1 == "127.0.0.1" { for (i = 2; i <= NF; i++) if ($i == "keycloak.idp") found = 1 } END { exit !found }' /etc/hosts; then
  printf '%s\n' '127.0.0.1 keycloak.idp' | sudo tee -a /etc/hosts >/dev/null
fi
```

This command preserves the existing file and appends the mapping only when the exact `127.0.0.1 keycloak.idp` association is absent.

Check the entry:

```sh
cat /etc/hosts
```

```sh
##
# Host Database
#
# localhost is used to configure the loopback interface
# when the system is booting.  Do not change this entry.
##
# 127.0.0.1       localhost
# 255.255.255.255 broadcasthost
# ::1             localhost
# 127.0.0.1 keycloak.idp
```

The mapping assumes `./tools/keep-k8s-port-forward.sh` exposes Keycloak HTTPS on local port `34444`. The port still belongs in the URL; `/etc/hosts` maps only the hostname.

## Step 4. Generate the athenzd config

`athenzd login` reads `current_service` from its config and uses that service's `idp` block to drive the login. The repo ships a generator that fills in the local ports for you and writes a project-level config at `athenzd/.athenzd/config.yaml`.

```sh
make -C athenzd idjag-learner
```

If a project config already exists, the generator prompts before overwriting it:

```sh
# Overwrite existing project config .../athenzd/.athenzd/config.yaml? [y/N]
```

Answer `y` to regenerate, or `N` to keep your edits. The generator validates the config and prints it:

```sh
# # Generated by hack/gen-idjag-learner-config.sh — do not edit. Run make idjag-learner to regenerate.
#
# athenz:
#   zts: https://localhost:8443/zts/v1
#   zms: https://localhost:4443/zms/v1
#
# current_service: idjag-learner
#
# services:
#   - name: idjag-learner
#     athenz:
#       domain: home.mlajkim
#       provider: sys.auth.zts
#     idp:
#       issuer: https://keycloak.idp:34444/realms/master
#       client_id: athenzd
#       callback_port: 8250
#       ca_file: /abs/path/to/athenz_dist/certs/ca.cert.pem
```

The generated config points `idp.issuer` at the **HTTPS** Keycloak endpoint (`https://keycloak.idp:34444`) and sets `idp.ca_file` to the Athenz tutorial CA (`athenz_dist/certs/ca.cert.pem`). `athenzd` trusts that CA when it performs the token exchange, and the certificate SAN includes `keycloak.idp`.

> [!NOTE]
> `domain: home.mlajkim` and `provider: sys.auth.zts` are placeholder values. For this login-only guide they do not matter — the ID token flow uses only the `idp` block.

## Step 5. Run `athenzd login`

Run the login so the project-level config is picked up. `athenzd` opens your browser to the Keycloak authorization URL and waits on the local callback:

```sh
(cd athenzd && athenzd login)
```

```sh
# config: .athenzd/config.yaml (project-level (.athenzd/config.yaml))
# Opening browser for login...
# If it doesn't open, visit:
#   https://keycloak.idp:34444/realms/master/protocol/openid-connect/auth?client_id=athenzd&code_challenge=...&code_challenge_method=S256&redirect_uri=http%3A%2F%2Flocalhost%3A8250%2Fcallback&response_type=code&scope=openid&state=...
```

Sign in to Keycloak as:

- Username: `idjag-learner`
- Password: `password`

After the redirect completes, the browser tab shows `Login successful — you can close this tab.` and the terminal confirms the cached token:

```sh
# Logged in as service "idjag-learner" — token cached until 2026-07-13T12:29:23+09:00 (~3h left)
```

## Step 6. Inspect the cached ID token

The token is cached at `~/.cache/athenzd/<current_service>.json`. Look at the cache envelope first:

```sh
cat ~/.cache/athenzd/idjag-learner.json
```

```sh
# {
#   "id_token": "eyJhbGciOiJSUzI1NiIsInR5cCIgOiAiSldUI...",
#   "expires_at": "2026-07-13T09:41:20Z"
# }
```

Decode the ID token payload above to confirm the claims:

```sh
jq -r '.id_token' ~/.cache/athenzd/idjag-learner.json \
  | jq -R 'split(".") | .[1] | @base64d | fromjson'
```

```sh
# {
#   "exp": 1783669280,
#   "iat": 1783668980,
#   "iss": "https://keycloak.idp:34444/realms/master",
#   "aud": "athenzd",
#   "sub": "3b1ebc43-f64d-446f-a388-b0431801fe57",
#   "typ": "ID",
#   "azp": "athenzd",
#   "preferred_username": "idjag-learner",
#   "email": "idjag-learner@athenz.io",
#   "name": "ID-JAG Learner"
# }
```

Confirm the important claims:

- `iss` is `https://keycloak.idp:34444/realms/master` — the HTTPS issuer from your config.
- `aud` / `azp` are `athenzd` — the shared Keycloak client from Step 2.
- `preferred_username` is `idjag-learner`. When ZMS is configured with `OIDCJwtAuthority`, it maps this claim to the Athenz principal `user.idjag-learner`; `home.idjag-learner` is that user's personal Athenz domain. This ZMS authentication is separate from the later ID-JAG exchange.

A valid, non-expired token with these claims means `athenzd login` is working end to end over HTTPS.

# Cleanup

When you finish the local `athenzd` test series, follow [Clean Up the Local `athenzd` Test](./99-clean-up.md). It removes the guide's artifacts in dependency order and removes only the exact `/etc/hosts` entry added above.

# Reference

- [Ensure the Home Domain, Local Subdomain, and `athenzd` Service With an ID Token](./02-ensure-home-domain-and-service-with-id-token.md): configures ZMS OIDC authentication and proves the intended post-login ensure flow.
- [Clean Up the Local `athenzd` Test](./99-clean-up.md): removes artifacts created by this guide series.
- [Make Keycloak HTTPS for ZTS User Certificates](../make-keycloak-https.md): sets up the HTTPS listener and the Athenz-CA-signed cert this guide relies on.
- [athenzd login (PKCE) implementation](../../athenzd/internal/login/login.go): `idp.ca_file` is loaded into a dedicated HTTP client so the token exchange trusts the tutorial CA.
- [athenzd config generator](../../athenzd/hack/gen-idjag-learner-config.sh): fills local ports and the CA path into `.athenzd/config.yaml`.
- [tools/keycloak/get-id-token.sh](../../tools/keycloak/get-id-token.sh): the direct-grant equivalent used elsewhere in the tutorial, and the source of the JWT-decode one-liner above.
