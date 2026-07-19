# Goal

Test `athenzd` against the local ID-JAG The Hard Way environment: configure Keycloak and ZMS, log in with a real ID token, idempotently ensure `home.<preferred_username>.local.athenzd`, inspect the result, and clean up only the objects created by this test.

<!-- TOC depthFrom:2 depthTo:3 -->

- [Step 1. Build and install athenzd](#step-1-build-and-install-athenzd)
- [Step 2. Create the Keycloak client](#step-2-create-the-keycloak-client)
- [Step 3. Map the Keycloak hostname](#step-3-map-the-keycloak-hostname)
- [Step 4. Configure ZMS OIDC authentication](#step-4-configure-zms-oidc-authentication)
- [Step 5. Confirm the personal parent domain exists](#step-5-confirm-the-personal-parent-domain-exists)
- [Step 6. Generate and validate the config](#step-6-generate-and-validate-the-config)
- [Step 7. Log in and ensure the service](#step-7-log-in-and-ensure-the-service)
- [Step 8. Verify idempotency and inspect the result](#step-8-verify-idempotency-and-inspect-the-result)
- [Cleanup 1. Remove the service and local child domain](#cleanup-1-remove-the-service-and-local-child-domain)
- [Cleanup 2. Remove the ZMS OIDC settings](#cleanup-2-remove-the-zms-oidc-settings)
- [Cleanup 3. Delete the Keycloak client](#cleanup-3-delete-the-keycloak-client)
- [Cleanup 4. Delete local files](#cleanup-4-delete-local-files)
- [Cleanup 5. Remove the hostname mapping](#cleanup-5-remove-the-hostname-mapping)

<!-- /TOC -->

<details>
<summary>Verification status — 🟡 Pending human verification</summary>

| # | Date | Status                                              |
|---|------|-----------------------------------------------------|
| 1 | TBD  | 🟡 Pending — human has not confirmed this procedure |

</details>

# Prerequisites

- Complete the main tutorial through [Identity Provider](../../tutorials/13-identity-provider.md).
- Leave `./tools/keep-k8s-port-forward.sh` running throughout setup, testing, and the first three cleanup steps.
- Complete [Make Keycloak HTTPS for ZTS User Certificates](../make-keycloak-https.md).
- Run commands from the repository root unless a command explicitly changes directory.
- Ensure the personal parent domain `home.idjag-learner` already exists. `athenzd` never creates the reserved `home` top-level domain or a user's personal parent domain.

> [!NOTE]
> This test covers browser login and ZMS registration only. It does not request an X.509 certificate, contact Copper Argos, or exchange the ID token for an Athenz access token.

The next Copper Argos building block is documented in [Build and Publish the Local Workload Instance Provider](./build-local-workload-instance-provider.md). That procedure builds the provider artifact but does not deploy it into ZTS.

# Steps

## Step 1. Build and install athenzd

```sh
make -C athenzd build
```

```text
go install ./cmd/athenzd
Installed: /Users/you/go/bin/athenzd
```

Confirm the binary runs:

```sh
athenzd version
```

`athenzd` resolves a project config relative to the current directory. Commands that load the generated config below run inside `athenzd/`.

## Step 2. Create the Keycloak client

Create one public Keycloak client for the browser Authorization Code flow with PKCE:

```sh
./tools/keycloak/create-client.sh \
  "athenzd" \
  "http://localhost:8250/callback" \
  "http://localhost:8250" \
  public
```

```text
· Fetching Keycloak admin token...
· Looking up client athenzd in realm master...
· Creating client athenzd...
✔ Client created: athenzd
```

The client must remain public, have the standard browser flow enabled, and allow `http://localhost:8250/callback` as a redirect URI.

## Step 3. Map the Keycloak hostname

Add an idempotent workstation mapping for the HTTPS port-forward:

```sh
if ! awk '$1 == "127.0.0.1" { for (i = 2; i <= NF; i++) if ($i == "keycloak.idp") found = 1 } END { exit !found }' /etc/hosts; then
  printf '%s\n' '127.0.0.1 keycloak.idp' | sudo tee -a /etc/hosts >/dev/null
fi
```

Check the result:

```sh
cat /etc/hosts
```

The output must include:

```text
127.0.0.1 keycloak.idp
```

`/etc/hosts` maps only the hostname. The Keycloak issuer still includes the forwarded HTTPS port `34444`.

## Step 4. Configure ZMS OIDC authentication

The local ZMS deployment mounts the plugin containing `com.yahoo.athenz.auth.impl.OIDCJwtAuthority`, but the authority must be enabled and configured before ZMS can authenticate the ID token.

Edit the ConfigMap:

```sh
kubectl edit configmap athenz-zms-conf -n athenz
```

Add the Java trust-store and OIDC properties to the existing `zms.properties` YAML value:

1. Type `/zms.properties:` and press **Enter**.
2. Press `o` to open a new line below it in Insert mode.
3. Paste the complete block below. Each line already contains the required four leading spaces.

```properties
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

4. Press **Esc**.

The four spaces belong to the ConfigMap YAML. They are not part of the Java property values.

Enable the authority in the existing authority list:

1. Type `/athenz.zms.authority_classes=` and press **Enter**.
2. Press `$`, then `a`.
3. Append this suffix without a leading space:

```properties
,com.yahoo.athenz.auth.impl.OIDCJwtAuthority
```

4. Press **Esc**.
5. Type `:wq` and press **Enter**.

The resulting property must remain one line:

```properties
athenz.zms.authority_classes=com.yahoo.athenz.auth.impl.CertificateAuthority,com.yahoo.athenz.auth.impl.AuthorizedServiceAuthHeaderAuthority,com.yahoo.athenz.auth.impl.OIDCJwtAuthority
```

> [!NOTE]
> The issuer exactly matches the browser-issued token's `iss` claim at `keycloak.idp:34444`. ZMS retrieves the signing keys through the in-cluster Keycloak HTTPS port `8443`. The claim mapping authenticates `preferred_username: idjag-learner` as `user.idjag-learner`.

Restart ZMS:

```sh
kubectl -n athenz rollout restart deployment/athenz-zms-server
kubectl -n athenz rollout status deployment/athenz-zms-server
```

Confirm the ZMS pod can retrieve the Keycloak signing keys:

```sh
kubectl -n athenz exec deployment/athenz-zms-server -- \
  curl -sS --cacert /etc/ssl/certs/ca-certificates.crt \
  https://keycloak.idp:8443/realms/master/protocol/openid-connect/certs \
  | jq
```

The result must contain at least one signing key with `"kty": "RSA"` and `"use": "sig"`.

## Step 5. Confirm the personal parent domain exists

Check the required parent with the tutorial administrator certificate:

```sh
curl -sS --cacert ./athenz_dist/certs/ca.cert.pem \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  "https://localhost:$(./tools/port.sh zms)/zms/v1/domain/home.idjag-learner" \
  | jq '{name, enabled}'
```

```json
{
  "name": "home.idjag-learner",
  "enabled": true
}
```

If ZMS returns `404`, stop and provision the personal parent through the environment's user-domain workflow. The expected `athenzd` error for a missing parent is:

```text
required personal home domain "home.idjag-learner" does not exist; athenzd does not create the reserved home TLD or personal home domains
```

## Step 6. Generate and validate the config

Generate the project-level config without an overwrite prompt:

```sh
FORCE=1 make -C athenzd idjag-learner
```

The generated config contains:

```yaml
athenz:
  zts: https://localhost:8443/zts/v1
  zms: https://localhost:4443/zms/v1
  ca_file: /absolute/path/to/athenz_dist/certs/ca.cert.pem

current_service: idjag-learner

services:
  - name: idjag-learner
    athenz:
      service: home.{{.preferred_username}}.local.athenzd
      optional_admins:
        - user.athenz_admin
      # provider: sys.auth.zts  # reserved for later certificate registration
    idp:
      issuer: https://keycloak.idp:34444/realms/master
      client_id: athenzd
      callback_port: 8250
      ca_file: /absolute/path/to/athenz_dist/certs/ca.cert.pem
```

`current_service` is the local profile and cache key. The full `athenz.service` template renders from the ID token's `preferred_username` claim. `optional_admins` is additive: the signed-in user remains an administrator, and each listed principal is added only when absent.

`provider` remains commented out because this flow does not register an instance or request a certificate.

Validate the generated file:

```sh
(cd athenzd && athenzd config validate)
```

```text
OK
  zts:              https://localhost:8443/zts/v1
  zms:              https://localhost:4443/zms/v1
  ca_file:          /absolute/path/to/athenz_dist/certs/ca.cert.pem
  current_service:  idjag-learner
  services (1):
    - name: idjag-learner  service: home.{{.preferred_username}}.local.athenzd
```

## Step 7. Log in and ensure the service

Run login immediately before the ZMS checks because the local authority accepts only recently issued tokens:

```sh
(cd athenzd && athenzd login)
```

Sign in to Keycloak as:

- Username: `idjag-learner`
- Password: `password`

Expected first-run result when the child domain and service are absent:

```text
Step 1/2 — Log in with the identity provider
Opening browser for login...
✓ ID token cached for current_service "idjag-learner" until 2026-07-19T13:11:50+09:00 (~3h left)

Step 2/2 — Ensure Athenz service home.idjag-learner.local.athenzd
✓ Required parent exists: home.idjag-learner
✓ Local subdomain home.idjag-learner.local: created
✓ Optional administrator user.athenz_admin: already present
✓ Service home.idjag-learner.local.athenzd: created
✓ Ready: home.idjag-learner.local.athenzd
```

The one service identity is separated internally into:

| Purpose               | Value                              |
|-----------------------|------------------------------------|
| Required parent       | `home.idjag-learner`               |
| Child domain          | `home.idjag-learner.local`         |
| Simple service name   | `athenzd`                          |
| Full service identity | `home.idjag-learner.local.athenzd` |

## Step 8. Verify idempotency and inspect the result

Run login again:

```sh
(cd athenzd && athenzd login)
```

The ZMS stage should now report no changes:

```text
Step 2/2 — Ensure Athenz service home.idjag-learner.local.athenzd
✓ Required parent exists: home.idjag-learner
✓ Local subdomain home.idjag-learner.local: already exists
✓ Optional administrator user.athenz_admin: already present
✓ Service home.idjag-learner.local.athenzd: already exists
✓ Ready: home.idjag-learner.local.athenzd
```

Inspect the cached identity without printing its bearer token:

```sh
(cd athenzd && athenzd whoami)
```

```text
profile:   idjag-learner
user:      idjag-learner
issuer:    https://keycloak.idp:34444/realms/master
audience:  athenzd
```

Open the child domain's service page in Athenz UI:

```sh
_athenz_ui_port="$(./tools/port.sh athenz-ui)"
./tools/open.sh "http://localhost:${_athenz_ui_port}/domain/home.idjag-learner.local/service"
```

```text
✔ Opened: http://localhost:3000/domain/home.idjag-learner.local/service
```

# Cleanup

Keep the Kubernetes environment and port-forwards running until Cleanup 3 is complete. Never delete `home.idjag-learner`; it is a prerequisite that `athenzd` did not create.

## Cleanup 1. Remove the service and local child domain

Run a fresh login so the cached token is inside the ZMS freshness window. This also confirms the objects exist immediately before removal:

```sh
(cd athenzd && athenzd login)
```

Load the token and exact targets:

```sh
_athenzd_profile="idjag-learner"
_token_cache="${HOME}/.cache/athenzd/${_athenzd_profile}.json"
_id_token="$(jq -er '.id_token' "${_token_cache}")"
_username="$(printf '%s' "${_id_token}" | jq -Rer 'split(".")[1] | @base64d | fromjson | .preferred_username')"
_home_domain="home.${_username}"
_local_domain_name="local"
_local_domain="${_home_domain}.${_local_domain_name}"
_service_name="athenzd"
_zms_url="https://localhost:$(./tools/port.sh zms)/zms/v1"
_ca_file="./athenz_dist/certs/ca.cert.pem"
_response_file="$(mktemp)"
trap 'rm -f "${_response_file}"' EXIT

printf 'service to delete: %s.%s\nlocal child domain to delete: %s\npersonal parent to keep: %s\n' \
  "${_local_domain}" "${_service_name}" "${_local_domain}" "${_home_domain}"
```

Delete the service if it was created solely by this test:

```sh
_http_code="$(curl -sS --cacert "${_ca_file}" \
  -o "${_response_file}" -w '%{http_code}' \
  -X DELETE \
  -H "Authorization: Bearer ${_id_token}" \
  "${_zms_url}/domain/${_local_domain}/service/${_service_name}")"

case "${_http_code}" in
  204) echo "Service deleted: ${_local_domain}.${_service_name}" ;;
  404) echo "Service already absent: ${_local_domain}.${_service_name}" ;;
  *)
    cat "${_response_file}" >&2
    echo "Failed to delete service: HTTP ${_http_code}" >&2
    false
    ;;
esac
```

Delete the local child domain if it was created solely by this test. This also removes its optional administrator membership:

```sh
_http_code="$(curl -sS --cacert "${_ca_file}" \
  -o "${_response_file}" -w '%{http_code}' \
  -X DELETE \
  -H "Authorization: Bearer ${_id_token}" \
  "${_zms_url}/subdomain/${_home_domain}/${_local_domain_name}")"

case "${_http_code}" in
  204) echo "Local child domain deleted: ${_local_domain}" ;;
  404) echo "Local child domain already absent: ${_local_domain}" ;;
  *)
    cat "${_response_file}" >&2
    echo "Failed to delete local child domain: HTTP ${_http_code}" >&2
    false
    ;;
esac
```

## Cleanup 2. Remove the ZMS OIDC settings

Keep the settings if ZMS should continue accepting `athenzd` ID tokens. Otherwise:

```sh
kubectl edit configmap athenz-zms-conf -n athenz
```

Inside `vim`:

1. Search for `/javax.net.ssl.trustStore=` and delete the three contiguous `javax.net.ssl.trustStore` lines with `3dd`.
2. Search for `/athenz.auth.principal.auth.oidc.jwt=` and delete the seven contiguous OIDC lines with `7dd`.
3. Search for `/,com.yahoo.athenz.auth.impl.OIDCJwtAuthority` and press `d$` to remove that suffix.
4. Type `:wq` and press **Enter**.

If the properties are no longer contiguous, search for and delete each matching line individually.

Restart ZMS:

```sh
kubectl -n athenz rollout restart deployment/athenz-zms-server
kubectl -n athenz rollout status deployment/athenz-zms-server
```

Verify the settings are absent:

```sh
_zms_properties="$(kubectl -n athenz get configmap athenz-zms-conf -o jsonpath='{.data.zms\.properties}')"

if printf '%s\n' "${_zms_properties}" \
  | grep -Eq '^javax\.net\.ssl\.trustStore|^athenz\.auth\.principal\.auth\.oidc\.jwt|^athenz\.zms\.authority_classes=.*OIDCJwtAuthority'; then
  echo 'ZMS OIDC or Java trust-store settings still exist' >&2
  false
else
  echo 'ZMS OIDC and Java trust-store settings removed'
fi
```

## Cleanup 3. Delete the Keycloak client

Delete the shared client only when no other user needs it:

```sh
./tools/keycloak/delete-client.sh "athenzd"
```

## Cleanup 4. Delete local files

Review the exact files:

```sh
ls -l "${HOME}/.cache/athenzd/idjag-learner.json" athenzd/.athenzd/config.yaml 2>/dev/null || true
```

Delete only this test's cache and generated config:

```sh
rm -f "${HOME}/.cache/athenzd/idjag-learner.json"
rm -f athenzd/.athenzd/config.yaml
```

## Cleanup 5. Remove the hostname mapping

Refuse to overwrite a backup left by an earlier attempt:

```sh
if sudo test -e /etc/hosts.athenzd.bak; then
  echo '/etc/hosts.athenzd.bak already exists; inspect or restore it before continuing' >&2
  false
fi
```

Create a backup and remove only the exact mapping added by this guide:

```sh
sudo sed -i.athenzd.bak '/^[[:space:]]*127\.0\.0\.1[[:space:]][[:space:]]*keycloak\.idp[[:space:]]*$/d' /etc/hosts
```

Verify the mapping is absent:

```sh
if grep -Eq '^[[:space:]]*127\.0\.0\.1[[:space:]][[:space:]]*keycloak\.idp[[:space:]]*$' /etc/hosts; then
  echo 'keycloak.idp mapping still exists' >&2
  false
else
  echo 'keycloak.idp mapping removed'
fi
```

After confirming `/etc/hosts` is correct, remove the backup:

```sh
sudo rm -f /etc/hosts.athenzd.bak
```

# FAQs

**Why use `home.{{.preferred_username}}.local.athenzd`?**

It is one complete service identity expressed as a Go template, using the same template family as `kubectl -o go-template`. The field name directly matches the ID token claim. Rendering occurs inside the Go binary and does not depend on shell substitution.

**Why does athenzd refuse to create `home` or `home.<user>`?**

`home` is a reserved top-level domain created during Athenz bootstrap. The personal parent belongs to user provisioning and ownership policy. `athenzd` limits itself to the configured direct child domain and service.

**What does `optional_admins` do?**

It adds administrators after the signed-in user. It never replaces the signed-in owner, duplicates are ignored, and omitting the list adds nobody else. The IDTHW generator includes `user.athenz_admin` only to simplify local inspection and cleanup.

**Why is `local.athenzd` not one service name?**

Athenz service names cannot contain a period. `home.<user>.local` is the domain and `athenzd` is the simple service name.

**Why are the issuer and JWKS URI different ports?**

The issuer must exactly match the token's `iss` claim from the browser-facing port `34444`. The ZMS pod retrieves the signing keys through Keycloak's in-cluster HTTPS port `8443`.

**Why can the JWKS curl succeed while ZMS returns HTTP 401?**

The curl command receives a CA explicitly, while the Java plugin needs the three `javax.net.ssl.trustStore` properties for its outbound HTTPS client. Inspect the ZMS reason with:

```sh
kubectl -n athenz logs deployment/athenz-zms-server --since=5m \
  | grep -E 'authenticate: :error|Unable to process key source|Unable to get http data'
```

**What does `boot_time_offset=300` do?**

The plugin rejects tokens whose `iat` is older than 300 seconds. `athenzd login` obtains a fresh token and immediately uses that token for the ensure calls.

**Does this call ZTS or Copper Argos?**

No. This flow performs ZMS domain, role-member, and service operations. Certificate registration comes later.

**Does cleanup delete the personal parent?**

No. Cleanup removes only the child service and child domain created by this test. It never deletes `home` or `home.<user>`.

# Reference

- [Build and Publish the Local Workload Instance Provider](./build-local-workload-instance-provider.md)
- [Make Keycloak HTTPS for ZTS User Certificates](../make-keycloak-https.md)
- [`athenzd` README](../../athenzd/README.md)
- [`athenzd` login command](../../athenzd/cmd/athenzd/login.go)
- [`athenzd` ZMS client](../../athenzd/internal/zms/client.go)
- [`athenzd` config generator](../../athenzd/hack/gen-idjag-learner-config.sh)
- [`OIDCJwtAuthority` configuration](https://github.com/ctyano/athenz-plugins#oidcjwtauthority)
- [Athenz domain API](https://github.com/AthenZ/athenz/blob/master/core/zms/src/main/rdl/Domain.rdli)
- [Athenz service-identity API](https://github.com/AthenZ/athenz/blob/master/core/zms/src/main/rdl/ServiceIdentity.rdli)
