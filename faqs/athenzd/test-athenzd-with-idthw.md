# Goal

Test `athenzd` against the local ID-JAG The Hard Way environment: configure Keycloak, ZMS, ZTS, and the published local-workload provider; log in with a real ID token; idempotently ensure `home.<preferred_username>.local.athenzd`; use that ID token as Copper Argos attestation to issue an X.509 service certificate; inspect the result; and clean up only the objects created by this test.

<!-- TOC depthFrom:2 depthTo:3 -->

- [Step 1. Build and install athenzd](#step-1-build-and-install-athenzd)
- [Step 2. Create the Keycloak client](#step-2-create-the-keycloak-client)
- [Step 3. Map the Keycloak hostname](#step-3-map-the-keycloak-hostname)
- [Step 4. Configure ZMS OIDC authentication](#step-4-configure-zms-oidc-authentication)
- [Step 5. Mount the published provider JAR into ZTS](#step-5-mount-the-published-provider-jar-into-zts)
- [Step 6. Configure the provider in ZTS](#step-6-configure-the-provider-in-zts)
- [Step 7. Register and authorize the provider in Athenz](#step-7-register-and-authorize-the-provider-in-athenz)
- [Step 8. Confirm the personal parent domain exists](#step-8-confirm-the-personal-parent-domain-exists)
- [Step 9. Generate and validate the config](#step-9-generate-and-validate-the-config)
- [Step 10. Log in and issue the service certificate](#step-10-log-in-and-issue-the-service-certificate)
- [Step 11. Verify the certificate and idempotency](#step-11-verify-the-certificate-and-idempotency)
- [Cleanup 1. Remove the service and local child domain](#cleanup-1-remove-the-service-and-local-child-domain)
- [Cleanup 2. Remove the provider registration](#cleanup-2-remove-the-provider-registration)
- [Cleanup 3. Remove the ZTS provider configuration](#cleanup-3-remove-the-zts-provider-configuration)
- [Cleanup 4. Remove the provider init container](#cleanup-4-remove-the-provider-init-container)
- [Cleanup 5. Remove the ZMS OIDC settings](#cleanup-5-remove-the-zms-oidc-settings)
- [Cleanup 6. Delete the Keycloak client](#cleanup-6-delete-the-keycloak-client)
- [Cleanup 7. Delete local files](#cleanup-7-delete-local-files)
- [Cleanup 8. Remove the hostname mapping](#cleanup-8-remove-the-hostname-mapping)

<!-- /TOC -->

<details>
<summary>Verification status — 🟡 Pending human verification</summary>

| # | Date | Status                                              |
|---|------|-----------------------------------------------------|
| 1 | TBD  | 🟡 Pending — human has not confirmed this procedure |

</details>

# Prerequisites

- Complete the main tutorial through [Identity Provider](../../tutorials/13-identity-provider.md).
- Leave `./tools/keep-k8s-port-forward.sh` running throughout setup, testing, and the first four cleanup steps.
- Complete [Make Keycloak HTTPS for ZTS User Certificates](../make-keycloak-https.md).
- Confirm that `ghcr.io/mlajkim/local-workload-instance-provider:latest` has been published.
- Run commands from the repository root unless a command explicitly changes directory.
- Ensure the personal parent domain `home.idjag-learner` already exists. `athenzd` never creates the reserved `home` top-level domain or a user's personal parent domain.

> [!NOTE]
> This test calls `POST /zts/v1/instance` and writes an X.509 certificate, private key, and signer CA locally. It does not exchange the ID token for an Athenz access token or start a long-running certificate-rotation daemon.

# Steps

## Step 1. Build and install athenzd

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

## Step 5. Mount the published provider JAR into ZTS

The GitHub Actions publish workflow builds and tests the provider. No local Maven or Docker build is required. Patch ZTS to pull the published `latest` image as an init container:

```sh
kubectl -n athenz patch deployment athenz-zts-server \
  --type=strategic \
  --patch '
spec:
  template:
    spec:
      initContainers:
        - name: fetch-local-workload-plugin
          image: ghcr.io/mlajkim/local-workload-instance-provider:latest
          imagePullPolicy: Always
          volumeMounts:
            - name: athenz-plugins
              mountPath: /export
'
```

The init container copies `local-workload-instance-provider.jar` into the existing `athenz-plugins` `emptyDir`. The ZTS container mounts the same volume at `/athenz/plugins`, which is already included in `USER_CLASSPATH`.

Wait for ZTS to restart with the PR image:

```sh
kubectl -n athenz rollout status deployment/athenz-zts-server
```

Confirm the init container placed the JAR in the running ZTS container:

```sh
kubectl -n athenz exec deployment/athenz-zts-server \
  -c athenz-zts-server -- \
  ls -l /athenz/plugins/local-workload-instance-provider.jar
```

```sh
# -rw-r--r-- 1 root root 12991 Jul 19 11:17 /athenz/plugins/local-workload-instance-provider.jar
```

Confirm the mounted JAR contains the provider class:

```sh
kubectl -n athenz exec deployment/athenz-zts-server \
  -c athenz-zts-server -- \
  sh -c "jar tf /athenz/plugins/local-workload-instance-provider.jar \
    | grep -F 'com/yahoo/athenz/instance/provider/impl/InstanceLocalWorkloadProvider.class'"
```

Expected class entry:

```text
com/yahoo/athenz/instance/provider/impl/InstanceLocalWorkloadProvider.class
```

## Step 6. Configure the provider in ZTS

Edit the ZTS ConfigMap:

```sh
kubectl edit configmap athenz-zts-conf -n athenz
```

Add these properties to the existing `zts.properties` YAML value:

1. Type `/zts.properties:` and press **Enter** to jump to the properties section.
2. Press `o` to open a new line below it in Insert mode.
3. Paste the complete block below. Each line already contains the required four leading spaces.

```properties
    athenz.zts.local_workload.issuer=https://keycloak.idp:34444/realms/master
    athenz.zts.local_workload.jwks_uri=https://keycloak.idp:8443/realms/master/protocol/openid-connect/certs
    athenz.zts.local_workload.audience=athenzd
    athenz.zts.local_workload.user_name_claim=preferred_username
    athenz.zts.local_workload.user_domain_template=home.%s.local
    athenz.zts.local_workload.boot_time_offset=300

```

4. Press **Esc**.
5. Type `:wq` and press **Enter** to save the ConfigMap.

The four spaces belong to the ConfigMap YAML. They are not part of the Java property values. You should see `configmap/athenz-zts-conf edited` after saving.

The issuer must exactly match the browser-issued token's `iss` claim. The explicit JWKS URI lets the ZTS pod retrieve the same issuer's keys through Keycloak's in-cluster HTTPS port. The provider maps `preferred_username: idjag-learner` to the permitted root `home.idjag-learner.local` and rejects enrollment for services outside that subtree.

Restart ZTS and wait for readiness:

```sh
kubectl -n athenz rollout restart deployment/athenz-zts-server
kubectl -n athenz rollout status deployment/athenz-zts-server
```

## Step 7. Register and authorize the provider in Athenz

Create the provider service only when it is absent:

```sh
./tools/athenz/create-service.sh \
  "sys.auth" \
  "localworkload"
```

```sh
  # ·  Registering Service: sys.auth.localworkload...
  # ✔  Service registered: sys.auth.localworkload
```

No public key is required for this class-based provider marker. The existing helper is idempotent: it checks `show-service` first and calls `add-service` only when `sys.auth.localworkload` is absent.

Set the service endpoint to the class provided by the mounted JAR:

```sh
./tools/athenz/set-service-endpoint.sh \
  "sys.auth" \
  "localworkload" \
  "class://com.yahoo.athenz.instance.provider.impl.InstanceLocalWorkloadProvider"
```

```sh
#   ·  Setting service endpoint for sys.auth.localworkload...
# [domain sys.auth service localworkload service-endpoint successfully updated]

#   ✔  Service endpoint set for sys.auth.localworkload: class://com.yahoo.athenz.instance.provider.impl.InstanceLocalWorkloadProvider
```

Apply the `instance_provider` solution template so `sys.auth.localworkload` passes ZTS's global provider authorization check:

```sh
./tools/athenz/set-domain-template.sh \
  "sys.auth" \
  "instance_provider" \
  "provider=sys.auth.localworkload" \
  "dnssuffix=local"
```

```sh
#   ·  Applying Domain Template: instance_provider -> sys.auth...
# [Template(s) successfully applied to domain]
#   ✔  Domain template applied: instance_provider -> sys.aut
```

Registering the service and its `class://` endpoint tells ZTS which Java implementation to invoke, but it does not authorize that service to act as an instance provider. This template adds `sys.auth.localworkload` to `sys.auth:role.providers` and grants that role `launch` on `sys.auth:instance`.

This is only the provider-level authorization check. Each target service must also authorize the provider separately. During login, `athenzd` applies the `identity_provisioning` template in `home.<user>.local`, granting `sys.auth.localworkload` `launch` on that specific service.

The standard `instance_provider` template also requires `dnssuffix`. The CSR generated by `athenzd` contains SPIFFE and provider-scoped instance-ID URI SANs but no DNS SAN, so the template's DNS launch rule is not used by this test; `local` is only the required template parameter.

Verify the endpoint and global provider-role membership:

```sh
./tools/athenz/show-service.sh \
  "sys.auth" \
  "localworkload" \
  | jq '{name, providerEndpoint}'

./tools/athenz/show-principal-roles.sh \
  "sys.auth.localworkload" \
  "sys.auth" \
  false \
  | jq -e '.memberRoles | any(.roleName == "sys.auth:role.providers")'
```

The first command must show the `class://` endpoint and the second must print `true`.

Restart ZTS once so its policy cache immediately sees the new provider service and global launch authorization:

```sh
kubectl -n athenz rollout restart deployment/athenz-zts-server
kubectl -n athenz rollout status deployment/athenz-zts-server
```

## Step 8. Confirm the personal parent domain exists

Check the required parent with the tutorial administrator certificate:

```sh
./tools/athenz/show-domain.sh \
  "home.idjag-learner" \
  | jq '{name, enabled}'
```

```json
{
  "name": "home.idjag-learner",
  "enabled": true
}
```

If the helper reports HTTP `404`, stop and provision the personal parent through the environment's user-domain workflow. The expected `athenzd` error for a missing parent is:

```text
required personal home domain "home.idjag-learner" does not exist; athenzd does not create the reserved home TLD or personal home domains
```

## Step 9. Generate and validate the config

Generate the project-level config:

```sh
make -C athenzd idjag-learner
```

## Step 10. Log in and issue the service certificate

Run login immediately before the ZMS checks because the local authority accepts only recently issued tokens:

```sh
(cd athenzd && athenzd login)
```

Sign in to Keycloak as:

- Username: `idjag-learner`
- Password: `password`

Expected first-run result when the child domain, service, and target launch authorization are absent:

```text
Step 1/3 — Log in with the identity provider
Opening browser for login...
✓ ID token cached for current_service "idjag-learner" until 2026-07-19T13:11:50+09:00 (~3h left)

Step 2/3 — Ensure Athenz service home.idjag-learner.local.athenzd
✓ Required parent exists: home.idjag-learner
✓ Local subdomain home.idjag-learner.local: created
✓ Optional administrator user.athenz_admin: already present
✓ Service home.idjag-learner.local.athenzd: created
✓ Provider launch authorization sys.auth.localworkload: applied
  Waiting up to 60s for ZTS to observe the new authorization...

Step 3/3 — Enroll X.509 identity through sys.auth.localworkload
✓ Certificate issued: home.idjag-learner.local.athenzd (instance idjag-learner-athenzd)
✓ Certificate: ~/.config/athenzd/identity/idjag-learner.cert.pem
✓ Private key: ~/.config/athenzd/identity/idjag-learner.key.pem
✓ Signer CA: ~/.config/athenzd/identity/ca.cert.pem
✓ Ready: home.idjag-learner.local.athenzd
```

`athenzd` applies the target domain's `identity_provisioning` solution template after creating the service. If that authorization changed, it retries an HTTP 403 from ZTS for up to 60 seconds while ZTS refreshes its policy cache. Other errors fail immediately.

The one service identity is separated internally into:

| Purpose               | Value                              |
|-----------------------|------------------------------------|
| Required parent       | `home.idjag-learner`               |
| Child domain          | `home.idjag-learner.local`         |
| Simple service name   | `athenzd`                          |
| Full service identity | `home.idjag-learner.local.athenzd` |

## Step 11. Verify the certificate and idempotency

Confirm the private key is owner-only and all three outputs exist:

```sh
ls -l \
  "${HOME}/.config/athenzd/identity/idjag-learner.cert.pem" \
  "${HOME}/.config/athenzd/identity/idjag-learner.key.pem" \
  "${HOME}/.config/athenzd/identity/ca.cert.pem"
```

The private key must show mode `-rw-------`. Verify that the issued certificate has the expected subject, issuer, validity, key usage, and URI SANs:

```sh
openssl x509 \
  -in "${HOME}/.config/athenzd/identity/idjag-learner.cert.pem" \
  -noout \
  -subject \
  -issuer \
  -dates \
  -ext extendedKeyUsage \
  -ext subjectAltName
```

The subject CN must be `home.idjag-learner.local.athenzd`. The extended key usage must permit TLS client authentication. The SAN output must include:

```text
URI:spiffe://home.idjag-learner.local/sa/athenzd
URI:athenz://instanceid/sys.auth.localworkload/idjag-learner-athenzd
```

Verify the private key matches the certificate without printing either credential:

```sh
_cert_pubkey_sha256="$(openssl x509 \
  -in "${HOME}/.config/athenzd/identity/idjag-learner.cert.pem" \
  -pubkey -noout \
  | openssl pkey -pubin -outform DER \
  | openssl dgst -sha256)"

_key_pubkey_sha256="$(openssl pkey \
  -in "${HOME}/.config/athenzd/identity/idjag-learner.key.pem" \
  -pubout -outform DER \
  | openssl dgst -sha256)"

test "${_cert_pubkey_sha256}" = "${_key_pubkey_sha256}" \
  && echo 'Certificate and private key match'
```

Verify the certificate against the signer chain returned by ZTS:

```sh
openssl verify \
  -CAfile "${HOME}/.config/athenzd/identity/ca.cert.pem" \
  "${HOME}/.config/athenzd/identity/idjag-learner.cert.pem"
```

Expected output:

```text
/Users/you/.config/athenzd/identity/idjag-learner.cert.pem: OK
```

Run login again:

```sh
(cd athenzd && athenzd login)
```

The ZMS stage should now report no changes:

```text
Step 2/3 — Ensure Athenz service home.idjag-learner.local.athenzd
✓ Required parent exists: home.idjag-learner
✓ Local subdomain home.idjag-learner.local: already exists
✓ Optional administrator user.athenz_admin: already present
✓ Service home.idjag-learner.local.athenzd: already exists
✓ Provider launch authorization sys.auth.localworkload: already present

Step 3/3 — Enroll X.509 identity through sys.auth.localworkload
✓ Certificate issued: home.idjag-learner.local.athenzd (instance idjag-learner-athenzd)
✓ Ready: home.idjag-learner.local.athenzd
```

The second login obtains a fresh ID token and a fresh certificate because the local-workload provider intentionally disables certificate refresh. It replaces the configured credential files only after ZTS returns and `athenzd` validates the response.

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

Keep the Kubernetes environment and port-forwards running until Cleanup 6 is complete. Never delete `home.idjag-learner`; it is a prerequisite that `athenzd` did not create.

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

Deleting the child domain also removes the `identity_provisioning` template, `identityproviders` role, and launch policy that `athenzd` applied inside that child domain.

## Cleanup 2. Remove the provider registration

Run this cleanup only if `sys.auth.localworkload` and the `instance_provider` application were created solely for this test. Removing a shared template application can affect other providers.

Remove the global provider template application:

```sh
kubectl -n athenz exec deployment/athenz-cli -- \
  zms-cli \
    -z https://athenz-zms-server.athenz:4443/zms/v1 \
    -key /var/run/athenz/athenz_admin.private.pem \
    -cert /var/run/athenz/athenz_admin.cert.pem \
    -d sys.auth \
    delete-domain-template instance_provider
```

Delete the provider service:

```sh
kubectl -n athenz exec deployment/athenz-cli -- \
  zms-cli \
    -z https://athenz-zms-server.athenz:4443/zms/v1 \
    -key /var/run/athenz/athenz_admin.private.pem \
    -cert /var/run/athenz/athenz_admin.cert.pem \
    -d sys.auth \
    delete-service localworkload
```

Verify the provider service is absent:

```sh
_http_code="$(curl -sS \
  --cacert ./athenz_dist/certs/ca.cert.pem \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  -o /dev/null -w '%{http_code}' \
  https://localhost:4443/zms/v1/domain/sys.auth/service/localworkload)"

test "${_http_code}" = 404 && echo 'Provider registration removed'
```

## Cleanup 3. Remove the ZTS provider configuration

Keep the properties if ZTS should continue accepting ID tokens through this provider. Otherwise, edit the ConfigMap:

```sh
kubectl edit configmap athenz-zts-conf -n athenz
```

Search for `/athenz.zts.local_workload.issuer=` and delete the six contiguous `athenz.zts.local_workload.*` lines with `6dd`, then save with `:wq`. If the properties are no longer contiguous, delete each matching line individually.

Restart ZTS and verify the properties are absent:

```sh
kubectl -n athenz rollout restart deployment/athenz-zts-server
kubectl -n athenz rollout status deployment/athenz-zts-server

if kubectl -n athenz get configmap athenz-zts-conf \
  -o jsonpath='{.data.zts\.properties}' \
  | grep -q '^athenz\.zts\.local_workload\.'; then
  echo 'Local-workload ZTS properties still exist' >&2
  false
else
  echo 'Local-workload ZTS properties removed'
fi
```

## Cleanup 4. Remove the provider init container

Remove only the init container added by Step 5:

```sh
kubectl -n athenz patch deployment athenz-zts-server \
  --type=strategic \
  --patch '
spec:
  template:
    spec:
      initContainers:
        - name: fetch-local-workload-plugin
          $patch: delete
'

kubectl -n athenz rollout status deployment/athenz-zts-server
```

The replacement pod receives a new `athenz-plugins` `emptyDir`, so the local workload JAR is no longer copied into it. Verify it is absent:

```sh
if kubectl -n athenz exec deployment/athenz-zts-server \
  -c athenz-zts-server -- \
  test -e /athenz/plugins/local-workload-instance-provider.jar; then
  echo 'Local workload provider JAR still exists' >&2
  false
else
  echo 'Local workload provider init container and JAR removed'
fi
```

## Cleanup 5. Remove the ZMS OIDC settings

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

## Cleanup 6. Delete the Keycloak client

Delete the shared client only when no other user needs it:

```sh
./tools/keycloak/delete-client.sh "athenzd"
```

## Cleanup 7. Delete local files

Review the exact files:

```sh
ls -l \
  "${HOME}/.cache/athenzd/idjag-learner.json" \
  "${HOME}/.config/athenzd/identity/idjag-learner.cert.pem" \
  "${HOME}/.config/athenzd/identity/idjag-learner.key.pem" \
  "${HOME}/.config/athenzd/identity/ca.cert.pem" \
  athenzd/.athenzd/config.yaml \
  2>/dev/null || true
```

Delete only this test's token cache, generated credentials, and generated config:

```sh
rm -f "${HOME}/.cache/athenzd/idjag-learner.json"
rm -f "${HOME}/.config/athenzd/identity/idjag-learner.cert.pem"
rm -f "${HOME}/.config/athenzd/identity/idjag-learner.key.pem"
rm -f "${HOME}/.config/athenzd/identity/ca.cert.pem"
rm -f athenzd/.athenzd/config.yaml
```

## Cleanup 8. Remove the hostname mapping

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

The ZMS authority and local-workload provider reject tokens whose `iat` is older than 300 seconds. `athenzd login` obtains a fresh token and immediately uses it for the ZMS ensure calls and ZTS attestation.

**Does this call ZTS or Copper Argos?**

Yes. With `identity.mode: copperargos`, `athenzd` generates an RSA private key and a CSR, puts the ID token in `attestationData`, and calls `POST /zts/v1/instance`. ZTS authorizes `sys.auth.localworkload`, invokes `InstanceLocalWorkloadProvider`, and returns the service certificate and signer chain. The private key never leaves the workstation.

**What is the difference between planned `local` mode and `copperargos` mode?**

`copperargos` is implemented now: it uses the ID token as attestation, requests a new certificate, and writes the configured certificate, key, and signer-CA outputs. A future `local` mode will read an externally managed certificate and private key from the configured paths instead of calling the instance provider. `local` mode is intentionally not implemented by this PR.

**Why does athenzd write files if Copper Argos is remote?**

Only certificate issuance is remote. `athenzd` generates and retains the private key locally, sends only the CSR and ID-token attestation, validates that the returned certificate matches that private key, and then writes the configured outputs. It uses mode `0600` for the key and `0644` for the certificate and signer CA.

**Why use an init container for the provider JAR?**

The published image is a JAR carrier rather than a long-running service. Its init container copies the JAR into an `emptyDir` shared with ZTS before ZTS starts, so the class is available on `USER_CLASSPATH` without a workstation build or a custom ZTS image.

**Why might the first ZTS registration briefly return HTTP 403?**

ZMS has already accepted the target `identity_provisioning` template, but ZTS may not have refreshed that domain in its policy cache yet. When `athenzd` applied the authorization during the same login, it retries only HTTP 403 responses for up to 60 seconds. A persistent 403 means the provider or target launch authorization is genuinely missing; inspect the focused ZTS log without printing the ID token:

```sh
kubectl -n athenz logs deployment/athenz-zts-server --since=5m \
  | grep -E 'not authorized to launch|unable to get instance for provider|unable to verify attestation data|CSR validation failed'
```

**Can `idp_user=idjag-learner` choose or override the authenticated user?**

No. A local setting cannot override the identity signed by the IdP. A future OIDC `login_hint` could prefill the login screen, but the returned ID token's configured username claim remains authoritative.

**How can I switch between multiple Keycloak users?**

Keycloak may reuse the current browser SSO session; OpenID Connect does not define one fixed username for the client. Use separate browser sessions or a login flow that forces account selection or reauthentication. Convenient multi-profile token caching is future `athenzd` work and is separate from the provider JAR.

**How do I register the current ZMS key id for ZTS?**

First confirm that ZTS is running but not ready:

```sh
kubectl -n athenz get deployment athenz-zts-server
kubectl -n athenz get pod -l app.kubernetes.io/name=athenz-zts-server
```

The broken state looks like `READY 0/1`. Kubernetes may still show the pod as `Running` because Jetty opened its port even though the ZTS application failed to initialize.

Get the current ZTS pod and inspect the previous container attempt because the liveness probe may already have restarted it:

```sh
_zts_pod="$(kubectl -n athenz get pod \
  -l app.kubernetes.io/name=athenz-zts-server \
  -o jsonpath='{.items[0].metadata.name}')"

kubectl -n athenz logs "${_zts_pod}" \
  -c athenz-zts-server \
  --previous \
  | grep -E 'validateSignedDomain|Unable to initialize storage subsystem|GET /zts/v1/status.* 503'
```

If Kubernetes reports that no previous terminated container exists, omit `--previous` to inspect the current attempt. The relevant failure looks like:

```text
validateSignedDomain: ZMS Public Key id=athenz-zms-server-... not available
ResourceException (500): Unable to initialize storage subsystem
GET /zts/v1/status HTTP/1.1" 503
```

This is the evidence that the provider init container is not the failure. The JAR can be copied successfully while ZTS still rejects every signed domain because the active ZMS signing-key ID is unknown. Keep the log filter when sharing output because unfiltered DEBUG logs can include authentication headers.

Print the active ZMS pod name, which is also the pod-derived ZMS signing-key ID in this deployment:

```sh
_zms_pod="$(kubectl -n athenz get pod \
  -l app.kubernetes.io/name=athenz-zms-server \
  -o jsonpath='{.items[0].metadata.name}')"

printf 'active ZMS key id: %s\n' "${_zms_pod}"
```

List the key IDs currently registered on `sys.auth.zms`:

```sh
curl -sS \
  --cacert ./athenz_dist/certs/ca.cert.pem \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  https://localhost:4443/zms/v1/domain/sys.auth/service/zms \
  | jq -r '.publicKeys[].id'
```

Registration is required when the active value printed above is absent from this list. Run this after a custom ZMS rebuild or restart if ZTS does not become ready:

```sh
_zms_pod="$(kubectl -n athenz get pod \
  -l app.kubernetes.io/name=athenz-zms-server \
  -o jsonpath='{.items[0].metadata.name}')"

kubectl -n athenz exec -i deployment/athenz-cli -- \
  sh -c "cat >/tmp/zms.public.pem && \
    zms-cli \
      -z https://athenz-zms-server.athenz:4443/zms/v1 \
      -key /var/run/athenz/athenz_admin.private.pem \
      -cert /var/run/athenz/athenz_admin.cert.pem \
      -d sys.auth \
      add-public-key zms '${_zms_pod}' /tmp/zms.public.pem" \
  < athenz_dist/kubernetes/athenz-zms-server/kustomize/keys/zms.public.pem
```

Confirm the active key ID was registered before restarting ZTS:

```sh
curl -sS \
  --cacert ./athenz_dist/certs/ca.cert.pem \
  --cert ./athenz_dist/certs/athenz_admin.cert.pem \
  --key ./athenz_dist/keys/athenz_admin.private.pem \
  https://localhost:4443/zms/v1/domain/sys.auth/service/zms \
  | jq -e --arg id "${_zms_pod}" '.publicKeys | any(.id == $id)'
```

Do not restart ZTS unless the command prints `true`. Once it does, restart ZTS so it reloads the signed domains:

```sh
kubectl -n athenz rollout restart deployment/athenz-zts-server
kubectl -n athenz rollout status deployment/athenz-zts-server
```

Finally, confirm that ZTS is ready:

```sh
kubectl -n athenz get deployment athenz-zts-server
```

The deployment must report `READY 1/1` and `AVAILABLE 1`.

**Does cleanup delete the personal parent?**

No. Cleanup removes only the child service and child domain created by this test. It never deletes `home` or `home.<user>`.

# Reference

- [Local workload instance provider](../../local_workload_instance_provider/README.md)
- [Local workload provider publish workflow](../../.github/workflows/publish-local-workload-instance-provider.yml)
- [Make Keycloak HTTPS for ZTS User Certificates](../make-keycloak-https.md)
- [`athenzd` README](../../athenzd/README.md)
- [`athenzd` login command](../../athenzd/cmd/athenzd/login.go)
- [`athenzd` ZMS client](../../athenzd/internal/zms/client.go)
- [`athenzd` ZTS enrollment client](../../athenzd/internal/zts/client.go)
- [`athenzd` config generator](../../athenzd/hack/gen-idjag-learner-config.sh)
- [`OIDCJwtAuthority` configuration](https://github.com/ctyano/athenz-plugins#oidcjwtauthority)
- [Athenz domain API](https://github.com/AthenZ/athenz/blob/master/core/zms/src/main/rdl/Domain.rdli)
- [Athenz service-identity API](https://github.com/AthenZ/athenz/blob/master/core/zms/src/main/rdl/ServiceIdentity.rdli)
- [Athenz instance-registration API](https://github.com/AthenZ/athenz/blob/master/core/zts/src/main/rdl/Instance.rdli)
- [Athenz Copper Argos development guide](https://github.com/AthenZ/athenz/blob/master/docs/copper_argos_dev.md)
