# Goal

Obtain an Athenz access token with an RFC 7523 assertion, then verify that Athenz v1.12.47 accepts replaying that API-audience token to obtain another access token.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Setup 1. Select Athenz v1.12.47](#setup-1-select-athenz-v11247)
- [Setup 2. Refresh the learner service certificate](#setup-2-refresh-the-learner-service-certificate)
- [Setup 3. Confirm the existing learner identity](#setup-3-confirm-the-existing-learner-identity)
- [Step 1. Get an access token with an RFC 7523 assertion](#step-1-get-an-access-token-with-an-rfc-7523-assertion)
- [Step 2. Get another token by replaying the access token](#step-2-get-another-token-by-replaying-the-access-token)

<!-- /TOC -->

<details>
<summary>Last verified on Oct 16, 2026 — ✅ Success</summary>

| # | Date | Confirmed Working |
|---|---|---|
| 1 | Oct 16, 2026 | Procedure prepared against v1.12.47 source |
| 2 | Oct 16, 2026 | ✅ User confirmed Step 1 token issuance and Step 2 access-token replay both succeeded with HTTP 200 |

The user confirmed that both steps worked. The result blocks remain selected, source-derived examples rather than captured command output. Additional diagnostics, variable response fields, decoded JWT objects, and raw token output are omitted from the examples. The helpers print complete non-sensitive diagnostics to stderr and issued access tokens to stdout. This page checks API access-token replay before the audience-validation fix in PR #3499.

</details>

# Prerequisites

1. Complete the main [ID-JAG The Hard Way tutorial](https://github.com/mlajkim/id-jag-the-hard-way/tree/main/tutorials), including the learner identity and `api:role.docs-getter` membership in [Granular Permission](../../../tutorials/07-granular-permission.md)
1. Keep the local Kubernetes cluster and `./tools/keep-k8s-port-forward.sh` running, with Bash, `kubectl`, `curl`, `jq`, and `openssl` available, together with the [version-switch prerequisites](../../../tools/README.md#switching-the-local-athenz-version)
1. Run each command block with Bash from the IDTHW repository root, using the existing learner service key at `./keys/idjag-learner.key` for key ID `v1`; run Steps 1 and 2 in the same Bash session

For the same request after the fix in [PR #3499](https://github.com/AthenZ/athenz/pull/3499), see the [261011 v1.12.48 comparison](./261011-jwt-client-assertion-audience-validation.md).

# Steps

## Setup 1. Select Athenz v1.12.47

Check that the running ZTS version is `1.12.47` or older. If this passes, continue to Setup 2.

```sh
./tools/athenz/athenz-version-verifier.sh --less-or-equal 1.12.47
```

```sh
#   ·  Checking Athenz ZTS version (maximum: 1.12.47, namespace: athenz)...
#   ✔  <zts-pod>: 1.12.47 is at or below the maximum 1.12.47
#   ✔  Athenz ZTS version check passed
```

If the verifier reports a newer version (exit `1`), select v1.12.47. The version-switch helper preserves the existing database. The result below is the expected final line. If the version cannot be verified (exit `2`), resolve that error first. Record the reported version if using an older release.

```sh
make athenz-vup VERSION=1.12.47
```

```sh
#   ✔  Athenz 1.12.47 is running; the existing database was preserved
```

## Setup 2. Refresh the learner service certificate

Refresh the service certificate for `human.idjag-learner` once here, using the existing private key for key ID `v1`. The command saves it to `./keys/idjag-learner.crt`. A still-valid certificate would also work. The RFC 7523 requests below use signed assertions without a client certificate.

```sh
./tools/athenz/fetch-cert.sh \
  human idjag-learner ./keys/idjag-learner.key v1
```

```sh
#   ·  Fetching X.509 Certificate for human.idjag-learner...
#   ·  Requesting DNS SAN domain: zts.athenz.cloud
#   ✔  Certificate saved to: ./keys/idjag-learner.crt
```

## Setup 3. Confirm the existing learner identity

Confirm that the existing service has key ID `v1`. The summary option prints identifiers rather than key material.

```sh
./tools/athenz/show-service.sh human idjag-learner --summary
```

```sh
#   ·  Showing service human.idjag-learner...
# service: human.idjag-learner
# public-key-ids: v1
```

Confirm that the same service is a member of `api:role.docs-getter`.

```sh
./tools/athenz/show-principal-roles.sh human.idjag-learner api
```

```sh
#   ·  Showing roles for human.idjag-learner in domain api...
# {
#   "memberName": "human.idjag-learner",
#   "memberRoles": [
#     {
#       "roleName": "docs-getter",
#       "domainName": "api"
#     }
#   ]
# }
```

## Step 1. Get an access token with an RFC 7523 assertion

Sign a fresh five-minute assertion as `human.idjag-learner` and submit it to ZTS as an RFC 7523 JWT bearer authorization grant. The signer discovers the running ZTS issuer and uses it as `aud`. The fetch helper sends the signed JWT as `assertion` and `api:role.docs-getter` as the HTTP `scope` parameter, then returns the access token. Save it in `_api_access_token` for Step 2.

```sh
_api_access_token=$(
  ./tools/athenz/sign-rfc7523-assertion.sh \
    --principal human.idjag-learner \
    --private-key ./keys/idjag-learner.key \
    --key-id v1 \
    --expires-in 300 \
    | ./tools/athenz/fetch-access-token-with-rfc7523.sh \
        - api:role.docs-getter
)
```

```sh
#   ·  Requesting an access token (jwt-bearer)...
#   ·  ZTS response (HTTP 200; credential values redacted):
# {
#   "access_token": "<redacted>",
#   "token_type": "Bearer"
# }
#   ✔  Access token issued (jwt-bearer)
```

The response contains a Bearer access token. Its decoded claims identify `human.idjag-learner` and have `aud=api`. The assertion addressed ZTS, but the issued access token addresses the API.

## Step 2. Get another token by replaying the access token

Suppose the API server, or someone who obtains the Bearer token from Step 1, tries to reuse it to get another access token from ZTS. Possessing that token does not prove possession of the learner's private key. Its `aud=api` permits use at the API; it does not identify ZTS as the intended recipient for client authentication or an RFC 7523 grant. Athenz v1.12.47 lacks the audience validation added by PR #3499 and accepts this reuse.

Submit `_api_access_token` saved in Step 1 to ZTS as an RFC 7523 `assertion`. This attempts to obtain another access token using the issued API access token. Use the same fetch helper as Step 1. It prints the ZTS response and returns the newly issued access token.

```sh
./tools/athenz/fetch-access-token-with-rfc7523.sh \
  "${_api_access_token}" api:role.docs-getter
```

```sh
#   ·  Requesting an access token (jwt-bearer)...
#   ·  ZTS response (HTTP 200; credential values redacted):
# {
#   "access_token": "<redacted>",
#   "token_type": "Bearer"
# }
#   ✔  Access token issued (jwt-bearer)
```

On v1.12.47, ZTS accepts this request with HTTP `200` and issues another access token even though the submitted token has `aud=api`. This demonstrates the missing audience check. The same request is rejected in the [261011 comparison](./261011-jwt-client-assertion-audience-validation.md#step-2-get-rejected-when-replaying-the-access-token-to-obtain-another-token).

# Reference

- [AccessTokenRequest.java at v1.12.47](https://github.com/AthenZ/athenz/blob/v1.12.47/servers/zts/src/main/java/com/yahoo/athenz/zts/token/AccessTokenRequest.java)
- [PR #3499 — Validate audience and caller binding for JWT client assertions](https://github.com/AthenZ/athenz/pull/3499)
- [261011 — v1.12.48 comparison](./261011-jwt-client-assertion-audience-validation.md)
- [RFC 7523 JWT bearer authorization grant baseline](./260813-rfc7523-jwt-bearer-authorization-grant.md)
