# Goal

Remove the local artifacts created by the `athenzd` login and ZMS home-domain test guides without tearing down the Kubernetes cluster or removing the shared Keycloak HTTPS setup. The ZMS objects are removed in child-first order: service, local subdomain, then personal home domain.

<!-- TOC depthFrom:2 depthTo:3 -->

- [Step 1. Remove the athenzd service, local subdomain, and home domain](#step-1-remove-the-athenzd-service-local-subdomain-and-home-domain)
- [Step 2. Remove the ZMS OIDC and Java trust-store properties](#step-2-remove-the-zms-oidc-and-java-trust-store-properties)
- [Step 3. Delete the Keycloak client](#step-3-delete-the-keycloak-client)
- [Step 4. Delete the cached token and generated config](#step-4-delete-the-cached-token-and-generated-config)
- [Step 5. Remove the workstation hostname mapping](#step-5-remove-the-workstation-hostname-mapping)

<!-- /TOC -->

<details>
<summary>Verification status — 🟡 Pending human verification</summary>

| # | Date | Status                                              |
|---|------|-----------------------------------------------------|
| 1 | TBD  | 🟡 Pending — human has not confirmed this procedure |

</details>

# Prerequisites

- Keep the local Kubernetes cluster and repository port-forwards running until Steps 1–3 are complete.
- Run commands from the repository root.
- Delete `home.<user>`, `home.<user>.local`, or `home.<user>.local.athenzd` only if the corresponding object was created solely for this test. Do not delete a pre-existing domain or service that contains other work.

# Cleanup

## Step 1. Remove the athenzd service, local subdomain, and home domain

Skip any deletion for an object that existed before the test. Remove objects created by the guide in child-first order: service, local subdomain, then home domain.

Guide 02 also adds `user.athenz_admin` to the local subdomain's `admin` role for testing. Deleting the local subdomain removes that role membership with the domain, so it does not require a separate cleanup call.

Run a fresh login because the local ZMS authority accepts an ID token only during its configured freshness window:

```sh
(cd athenzd && athenzd login)
```

Load the exact targets:

```sh
_athenzd_service="idjag-learner"
_token_cache="${HOME}/.cache/athenzd/${_athenzd_service}.json"
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

printf 'service to delete: %s.%s\nlocal subdomain to delete: %s\nhome domain to delete: %s\n' \
  "${_local_domain}" "${_service_name}" "${_local_domain}" "${_home_domain}"
```

If the displayed service was created solely by the test, delete it. HTTP `204` means it was deleted and `404` means it was already absent:

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

If the displayed local subdomain was created solely by the test, delete it next. HTTP `204` means it was deleted and `404` means it was already absent:

```sh
_http_code="$(curl -sS --cacert "${_ca_file}" \
  -o "${_response_file}" -w '%{http_code}' \
  -X DELETE \
  -H "Authorization: Bearer ${_id_token}" \
  "${_zms_url}/subdomain/${_home_domain}/${_local_domain_name}")"

case "${_http_code}" in
  204) echo "Local subdomain deleted: ${_local_domain}" ;;
  404) echo "Local subdomain already absent: ${_local_domain}" ;;
  *)
    cat "${_response_file}" >&2
    echo "Failed to delete local subdomain: HTTP ${_http_code}" >&2
    false
    ;;
esac
```

If the displayed home domain was also created solely by the test, delete it last through the dedicated user-domain API:

```sh
_http_code="$(curl -sS --cacert "${_ca_file}" \
  -o "${_response_file}" -w '%{http_code}' \
  -X DELETE \
  -H "Authorization: Bearer ${_id_token}" \
  "${_zms_url}/userdomain/${_username}")"

case "${_http_code}" in
  204) echo "Home domain deleted: ${_home_domain}" ;;
  404) echo "Home domain already absent: ${_home_domain}" ;;
  *)
    cat "${_response_file}" >&2
    echo "Failed to delete home domain: HTTP ${_http_code}" >&2
    false
    ;;
esac
```

## Step 2. Remove the ZMS OIDC and Java trust-store properties

Keep these settings if ZMS should continue accepting `athenzd` ID tokens. Otherwise, edit the ZMS ConfigMap:

```sh
kubectl edit configmap athenz-zms-conf -n athenz
```

Follow these steps inside `vim`:

1. Type `/javax.net.ssl.trustStore=` and press **Enter** to find the first Java trust-store property added by guide 02.
2. If all three `javax.net.ssl.trustStore` properties are still contiguous, type `3dd` to delete them. Otherwise, search for each property and press `dd` on each matching line.
3. Type `/athenz.auth.principal.auth.oidc.jwt=` and press **Enter** to find the first OIDC property added by guide 02.
4. If all seven `athenz.auth.principal.auth.oidc.jwt` properties are still contiguous, type `7dd` to delete them. Otherwise, search for each property and press `dd` on each matching line.
5. Type `/,com.yahoo.athenz.auth.impl.OIDCJwtAuthority` and press **Enter** to find the suffix added to `athenz.zms.authority_classes`.
6. Press `d$` to delete from that comma through the end of the line.
7. Type `:wq` and press **Enter** to save and exit.

Restart ZMS:

```sh
kubectl -n athenz rollout restart deployment/athenz-zms-server
kubectl -n athenz rollout status deployment/athenz-zms-server
```

Verify that the request-authentication settings are gone:

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

## Step 3. Delete the Keycloak client

Delete the shared local `athenzd` client only when no other user needs it:

```sh
./tools/keycloak/delete-client.sh "athenzd"
```

```sh
# ✔ Client deleted: athenzd
```

## Step 4. Delete the cached token and generated config

Review the exact files before deleting them:

```sh
ls -l "${HOME}/.cache/athenzd/idjag-learner.json" athenzd/.athenzd/config.yaml 2>/dev/null || true
```

Delete only the token cache and generated project config from this guide:

```sh
rm -f "${HOME}/.cache/athenzd/idjag-learner.json"
rm -f athenzd/.athenzd/config.yaml
```

## Step 5. Remove the workstation hostname mapping

Remove only the exact line added by guide 01. First refuse to overwrite a backup from an earlier cleanup attempt:

```sh
if sudo test -e /etc/hosts.athenzd.bak; then
  echo '/etc/hosts.athenzd.bak already exists; inspect or restore it before continuing' >&2
  false
fi
```

Create the cleanup-specific backup and remove the mapping:

```sh
sudo sed -i.athenzd.bak '/^[[:space:]]*127\.0\.0\.1[[:space:]][[:space:]]*keycloak\.idp[[:space:]]*$/d' /etc/hosts
```

Check the result:

```sh
cat /etc/hosts
```

The output must no longer contain this line:

```text
127.0.0.1 keycloak.idp
```

Verify it programmatically:

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

**Does this remove the shared Keycloak HTTPS setup?**

No. This guide does not remove the Keycloak Envoy sidecar, TLS secret, certificate, or HTTPS service port because other repository tutorials may depend on them.

**Should I always delete the home domain?**

No. Delete it only if guide 02 created it solely for this test. Keep it if it existed beforehand, contains other services, or is intended to become the persistent `athenzd` home domain.

**Can I keep ZMS OIDC authentication enabled?**

Yes. Step 2 is optional when the local ZMS server should continue authenticating Keycloak ID tokens.

# Reference

- [Log In With `athenzd` and Inspect the ID Token](./01-log-in-and-inspect-id-token.md)
- [Ensure the Home Domain, Local Subdomain, and `athenzd` Service With an ID Token](./02-ensure-home-domain-and-service-with-id-token.md)
- [Delete a Keycloak client](../../tools/keycloak/delete-client.sh)
- [Athenz user-domain API](https://github.com/AthenZ/athenz/blob/master/core/zms/src/main/rdl/Domain.rdli)
- [Athenz service-identity API](https://github.com/AthenZ/athenz/blob/master/core/zms/src/main/rdl/ServiceIdentity.rdli)
