# Goal

The goal of this document is to verify that Athenz ZTS records the requested user principal in its access log when successfully issuing a certificate through the user-certificate API, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Reissue the tested user certificate](#step-1-reissue-the-tested-user-certificate)
- [Step 2. Verify the requested principal in the ZTS access log](#step-2-verify-the-requested-principal-in-the-zts-access-log)

<!-- /TOC -->

<details>
<summary>Last human verified on Aug 13, 2026 — ✅ Success</summary>

| # | Date         | Confirmed Working                                                |
|---|--------------|------------------------------------------------------------------|
| 1 | Aug 13, 2026 | ✅ Human verified — user principal appeared in the ZTS access log |

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete the main [ID-JAG The Hard Way tutorial](../../../tutorials/16-id-jag.md), including the final ID-JAG step.
1. Complete [Fetch an Athenz user certificate](../../../faqs/fetch-athenz-user-cert.md) successfully. This prepares the user-certificate provider, Keycloak flow, private key, and `user.idjag-learner` certificate request.

# Steps

Here is the procedure to get to the goals.

## Step 1. Reissue the tested user certificate

Record the current UTC time so Step 2 searches only logs produced by this test:

```sh
_log_since=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
echo $_log_since
```

```sh
# 2026-08-13T09:23:21Z
```

Rerun the user-certificate helper with the key and output path prepared by the prerequisite FAQ:

```sh
./tools/athenz/fetch-user-cert.sh \
  ./keys/user-idjag-learner.key \
  user.idjag-learner \
  ./keys/user-idjag-learner.crt
```

```sh
#   ·  Checking zts-usercert in athenz-cli...
#   ·  Ensuring Keycloak client allows callback URI http://127.0.0.1:9213/oauth2/callback...
#   ...
#   ·  Running zts-usercert inside athenz-cli...
#   ·  Opening the Keycloak authorization URL from your host browser...
#   ✔  Opened: https://localhost:34444/realms/master/protocol/openid-connect/auth?...
#   ·  Copying issued certificate to ./keys/user-idjag-learner.crt...
#   ✔  User certificate saved to: ./keys/user-idjag-learner.crt
```

When the browser opens, sign in with the same `idjag-learner` Keycloak account used by the prerequisite FAQ. Confirm that the refreshed certificate belongs to the requested principal:

```sh
openssl x509 \
  -in ./keys/user-idjag-learner.crt \
  -noout \
  -subject
```

```sh
# subject=O=Athenz, OU=Athenz, CN=user.idjag-learner
```

## Step 2. Verify the requested principal in the ZTS access log

Read only the ZTS logs written since `_log_since`, then select the user-certificate request containing the expected principal:

```sh
kubectl -n athenz logs deployment/athenz-zts-server \
  --container athenz-zts-server \
  --since-time="${_log_since}" \
  | tr -d '\r' \
  | grep ' - user.idjag-learner ' \
  | grep '"POST /zts/v1/usercert '
```

```sh
# 10.244.0.6 - user.idjag-learner [13/Aug/2026:09:23:41 +0000] "POST /zts/v1/usercert HTTP/1.1" 200 1588 "-" "Go-http-client/1.1" 1352 39 Auth-None TLSv1.3 TLS_AES_256_GCM_SHA384 -
```

The value between the first separator and the timestamp is the Athenz access-log principal field. Seeing `user.idjag-learner` there verifies PR #3369. Before the change, the equivalent log format would have contained `-` in that field:

```sh
# 10.244.0.6 - - [13/Aug/2026:09:23:41 +0000] "POST /zts/v1/usercert HTTP/1.1" 200 1588 "-" "Go-http-client/1.1" 1352 39 Auth-None TLSv1.3 TLS_AES_256_GCM_SHA384 -
```

This second line is a pre-change reconstruction of the captured log for comparison; it is not a separately captured historical entry.

# Reference

- [Athenz PR #3369 — log principal name for usercert api](https://github.com/AthenZ/athenz/pull/3369)
- [Athenz user-certificate FAQ](../../../faqs/fetch-athenz-user-cert.md)
