# Goal

Configure the local ZMS server to authenticate the ID token cached by `athenzd login`, then use that token to idempotently ensure the signed-in user owns `home.<user>`, the `home.<user>.local` subdomain exists, and the `athenzd` service exists there as `home.<user>.local.athenzd`.



<!-- TOC depthFrom:2 depthTo:3 -->

- [Step 1. Configure ZMS to authenticate the Keycloak ID token](#step-1-configure-zms-to-authenticate-the-keycloak-id-token)
- [Step 2. Log in and inspect the cached identity](#step-2-log-in-and-inspect-the-cached-identity)
- [Step 3. Ensure the home domain, local subdomain, and athenzd service](#step-3-ensure-the-home-domain-local-subdomain-and-athenzd-service)

<!-- /TOC -->

<details>
<summary>Last verified on 2026-07-19 — ✅ Success</summary>

| # | Date       | Status                                                                                |
|---|------------|---------------------------------------------------------------------------------------|
| 1 | 2026-07-19 | ✅ Success — human confirmed the home-domain, local-subdomain, and service ensure flow |

</details>

# Prerequisites

- Complete the main tutorial through [Identity Provider](../../tutorials/13-identity-provider.md) and leave `./tools/keep-k8s-port-forward.sh` running so the local Kubernetes services remain available from the workstation.
- Complete [Log In With `athenzd` and Inspect the ID Token](./01-log-in-and-inspect-id-token.md).
- Complete [Make Keycloak HTTPS for ZTS User Certificates](../make-keycloak-https.md). ZMS must trust the tutorial CA when it fetches Keycloak's JWKS over the in-cluster HTTPS endpoint.
- Use the default local endpoints from this repository: Keycloak issuer `https://keycloak.idp:34444/realms/master`, Keycloak client ID `athenzd`, and ZMS `https://localhost:4443/zms/v1`.
- Confirm that the preceding login guide added `127.0.0.1 keycloak.idp` to the workstation's `/etc/hosts` file.

> [!NOTE]
> The current `athenzd login` implementation stops after caching the ID token. The manual ZMS calls below prove the exact ensure flow that `athenzd` can automate later; they do not claim that the CLI already performs it.

# Steps

## Step 1. Configure ZMS to authenticate the Keycloak ID token

The ZMS deployment already mounts the `ghcr.io/ctyano/athenz-plugins` JAR, which contains `com.yahoo.athenz.auth.impl.OIDCJwtAuthority`. ZMS does not enable that authority by default, so add it to the runtime configuration.

Edit the ZMS ConfigMap:

```sh
kubectl edit configmap athenz-zms-conf -n athenz
```

First, add the Java HTTPS trust-store settings and OIDC properties to the same `zms.properties` value:

1. Type `/zms.properties:` and press **Enter** to jump to the YAML block containing the ZMS properties.
2. Press `o` to open a new line below it in Insert mode.
3. Paste the entire block below exactly as shown. Every line already includes the four leading spaces required by the ConfigMap YAML.

```sh
    javax.net.ssl.trustStore=/var/run/athenz/truststore/zms_truststore.jks
    javax.net.ssl.trustStoreType=JKS
    javax.net.ssl.trustStorePassword=athenz
    athenz.auth.principal.auth.oidc.jwt=Authorization
    athenz.auth.principal.auth.oidc.jwt.domain=user
    athenz.auth.principal.auth.oidc.jwt.issuer=https://keycloak.idp:34444/realms/master
    athenz.auth.principal.auth.oidc.jwt.audience=athenzd
    athenz.auth.principal.auth.oidc.jwt.jwks_uri=https://keycloak.idp:8443/realms/master/protocol/openid-connect/certs
    athenz.auth.principal.auth.oidc.jwt.claim=preferred_username
    athenz.auth.principal.auth.oidc.jwt.boot_time_offset=300
```

4. Press **Esc** to leave Insert mode.

The four-space indentation belongs to the ConfigMap YAML and is not part of the Java property itself. A property at column 1 makes the YAML invalid, while eight spaces change the block content. The `javax.net.ssl.trustStore` properties make the plugin's Java HTTPS client use the ZMS trust store generated from the mounted Athenz CA; the `athenz.ssl_trust_store` server setting alone does not configure that outbound client.

Next, enable the authority in the existing authority list:

1. Type `/athenz.zms.authority_classes=` and press **Enter** to find the existing authority list.
2. Press `$` to move to the end of that line.
3. Press `a` to enter Insert mode after the final character.
4. Paste the following text without adding a space:

```sh
,com.yahoo.athenz.auth.impl.OIDCJwtAuthority
```

5. Press **Esc** to leave Insert mode.
6. Type `:wq` and press **Enter** to save the ConfigMap and exit.

The resulting property must remain one comma-separated line:

```sh
athenz.zms.authority_classes=com.yahoo.athenz.auth.impl.CertificateAuthority,com.yahoo.athenz.auth.impl.AuthorizedServiceAuthHeaderAuthority,com.yahoo.athenz.auth.impl.OIDCJwtAuthority
```

> [!NOTE]
> The issuer must exactly match the token's `iss` claim, so it uses the browser-facing `keycloak.idp:34444` URL. The separate JWKS URI uses the in-cluster Keycloak HTTPS port `8443` that the ZMS pod can reach. The claim mapping turns `preferred_username: idjag-learner` into the Athenz principal `user.idjag-learner`.

Restart ZMS so it reloads the authority list and properties:

```sh
kubectl -n athenz rollout restart deployment/athenz-zms-server
kubectl -n athenz rollout status deployment/athenz-zms-server
```

Confirm that the ZMS pod can fetch Keycloak's signing keys through the configured in-cluster URI:

```sh
kubectl -n athenz exec deployment/athenz-zms-server -- \
  curl -sS --cacert /etc/ssl/certs/ca-certificates.crt \
  https://keycloak.idp:8443/realms/master/protocol/openid-connect/certs \
  | jq
```

```sh
# {
#   "keys": [
#     {
#       "kid": "jio8OS-7FzKy8UfOCol-zj1946k1y1JyC6Z6D676WKc",
#       "kty": "RSA",
#       "alg": "RS256",
#       "use": "sig",
# ...
```

## Step 2. Log in and inspect the cached identity

Run a fresh login immediately before testing. The local authority configuration accepts tokens issued within the last 300 seconds.

```sh
(cd athenzd && athenzd login)
```

Inspect the identity without printing the token:

```sh
(cd athenzd && athenzd whoami)
```

```sh
# service:   idjag-learner
# user:      idjag-learner
# issuer:    https://keycloak.idp:34444/realms/master
# audience:  athenzd
# ...
```

## Step 3. Ensure the home domain, local subdomain, and athenzd service

Pass the path of the cached ID token to `create-home-subdomain.sh`:

```sh
./tools/athenz/create-home-subdomain.sh \
  "${HOME}/.cache/athenzd/idjag-learner.json"
```

The script accepts either an `athenzd` JSON cache file containing `id_token` or a file containing only the raw JWT. It derives `preferred_username`, authenticates to ZMS, creates `home.<user>` through the dedicated user-domain API when absent, creates its `local` subdomain when absent, ensures both the signed-in user and `user.athenz_admin` administer that subdomain, and registers the simple service name `athenzd` there. The resulting full service identity is `home.<user>.local.athenzd`.

Expected result on the first run:

```sh
# ▶ Authenticating to ZMS with the provided ID token
#   ✔  Authenticated as user.idjag-learner

# ▶ Ensuring personal domain home.idjag-learner
#   ✔  Home domain created: home.idjag-learner

# ▶ Ensuring local subdomain home.idjag-learner.local
#   ✔  Local subdomain created: home.idjag-learner.local

# ▶ Ensuring administrator user.athenz_admin on home.idjag-learner.local
#   ✔  Administrator already present: user.athenz_admin

# ▶ Ensuring service home.idjag-learner.local.athenzd
#   ✔  Service created: home.idjag-learner.local.athenzd
#   ✔  Ready: home.idjag-learner.local.athenzd
```

Rerun the same command to verify that the operation is idempotent:

```sh
# ▶ Authenticating to ZMS with the provided ID token
#   ✔  Authenticated as user.idjag-learner

# ▶ Ensuring personal domain home.idjag-learner
#   ✔  Home domain already exists: home.idjag-learner

# ▶ Ensuring local subdomain home.idjag-learner.local
#   ✔  Local subdomain already exists: home.idjag-learner.local

# ▶ Ensuring administrator user.athenz_admin on home.idjag-learner.local
#   ✔  Administrator already present: user.athenz_admin

# ▶ Ensuring service home.idjag-learner.local.athenzd
#   ✔  Service already exists: home.idjag-learner.local.athenzd
#   ✔  Ready: home.idjag-learner.local.athenzd
```

If ZMS returns HTTP `401`, run `athenzd login` again and immediately rerun the helper because the local authority accepts only recently issued ID tokens.

# Cleanup

When you finish the local `athenzd` test series, follow [Clean Up the Local `athenzd` Test](./99-clean-up.md). It removes the service, local subdomain, and personal domain before disabling ZMS OIDC authentication, then cleans up the Keycloak client, local files, and `/etc/hosts` entry.

# FAQs

**Why use `POST /userdomain/{name}` for the personal domain?**

ZMS creates the reserved `home` top-level domain during initial system setup when `athenz.home_domain=home`. The user-domain API then creates the personal domain and automatically assigns the matching `user.<name>` principal as its administrator. A regular user is not authorized to create a top-level domain with `POST /domain`. Once the user owns `home.<user>`, the standard `POST /subdomain/{parent}` API creates `home.<user>.local` beneath it.

**Why is `local.athenzd` not passed as the service name?**

Athenz service names use the `SimpleName` type and cannot contain a period. In the full identity `home.<user>.local.athenzd`, `home.<user>.local` is the domain and `athenzd` is the service name. Passing `local.athenzd` as the service path segment makes ZMS return HTTP `400` with `Invalid SimpleName`.

**Why is `user.athenz_admin` also a subdomain administrator?**

The signed-in user remains an administrator and owner of their personal setup. Adding the tutorial administrator to `home.<user>.local:role.admin` makes it easier to inspect, repair, or remove the local test service with the repository's existing admin-certificate tools. This convenience is intended for the local tutorial environment, not a production ownership model.

**Is `OIDCJwtAuthority` part of upstream Athenz?**

The class used by this repository comes from the unofficial `ctyano/athenz-plugins` project. The local ZMS deployment already mounts that plugin JAR, but the authority must still be listed in `athenz.zms.authority_classes` before ZMS will use it for request authentication.

**Why are the issuer and JWKS URI different hosts?**

JWT validation requires the configured issuer to exactly match the signed `iss` claim. The workstation reaches `keycloak.idp:34444` through `/etc/hosts` and the port-forward, while the ZMS pod reaches the same Kubernetes service on `keycloak.idp:8443`. The explicit JWKS URI uses the reachable in-cluster port without changing the expected token issuer.

**Why can the in-pod `curl` check succeed while ZMS still returns HTTP 401?**

The check passes `--cacert` directly to `curl`, while `OIDCJwtAuthority` uses Java's default HTTPS client when it retrieves the JWKS. The three `javax.net.ssl.trustStore` properties point that Java client at the generated ZMS trust store. Without them, the ZMS log reports `PKIX path building failed`, followed by `RateLimitReachedException` after repeated retrieval attempts.

After correcting the trust-store properties, restart ZMS and run a fresh `athenzd login` before retrying. If authentication still returns HTTP `401`, inspect the exact server-side reason:

```sh
kubectl -n athenz logs deployment/athenz-zms-server --since=5m \
  | grep -E 'authenticate: :error|Unable to process key source|Unable to get http data'
```

**What does `boot_time_offset=300` do?**

The plugin rejects tokens whose `iat` is older than the configured number of seconds. Five minutes limits replay of an old ID token, but it also means this test must run immediately after `athenzd login`. `create-home-subdomain.sh` checks the token age before contacting ZMS and tells you to log in again when the cached token is too old. A future `athenzd` implementation should obtain a fresh login before running the ensure flow instead of silently increasing this window.

**Should `athenz.zms.user_authority_class` also be set?**

Not for this request-authentication flow. `athenz.zms.authority_classes` controls how incoming requests are authenticated. `athenz.zms.user_authority_class` is a separate hook ZMS may use when validating user principals added to roles or groups.

**Does this call ZTS or Copper Argos?**

No. Domain and service registration are ZMS operations. ZTS instance registration and certificate issuance happen later, after the service already exists in ZMS.

**Does `athenzd login` already run these ensure calls?**

No. At the time of this FAQ, `athenzd login` performs browser PKCE login and caches the ID token. Run `create-home-subdomain.sh` with that cache path to perform the ensure calls.

# Reference

- [Log In With `athenzd` and Inspect the ID Token](./01-log-in-and-inspect-id-token.md)
- [Clean Up the Local `athenzd` Test](./99-clean-up.md)
- [`create-home-subdomain.sh`](../../tools/athenz/create-home-subdomain.sh)
- [Local ZMS properties](../../athenz_dist/kubernetes/athenz-zms-server/kustomize/conf/zms.properties)
- [`OIDCJwtAuthority` configuration](https://github.com/ctyano/athenz-plugins#oidcjwtauthority)
- [`OIDCJwtAuthority` source](https://github.com/ctyano/athenz-plugins/blob/main/src/main/java/com/yahoo/athenz/auth/impl/OIDCJwtAuthority.java)
- [Athenz user-domain API](https://github.com/AthenZ/athenz/blob/master/core/zms/src/main/rdl/Domain.rdli)
- [Athenz service-identity API](https://github.com/AthenZ/athenz/blob/master/core/zms/src/main/rdl/ServiceIdentity.rdli)
