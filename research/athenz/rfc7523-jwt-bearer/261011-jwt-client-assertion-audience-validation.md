# Goal

Obtain an Athenz access token with an RFC 7523 assertion, then verify that Athenz v1.12.48 or newer rejects replaying that API-audience token to obtain another access token.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Setup 1. Select Athenz v1.12.48 or newer](#setup-1-select-athenz-v11248-or-newer)
- [Setup 2. Refresh the learner service certificate](#setup-2-refresh-the-learner-service-certificate)
- [Setup 3. Confirm the existing learner identity](#setup-3-confirm-the-existing-learner-identity)
- [Step 1. Get an access token with an RFC 7523 assertion](#step-1-get-an-access-token-with-an-rfc-7523-assertion)
- [Step 2. Get rejected when replaying the access token to obtain another token](#step-2-get-rejected-when-replaying-the-access-token-to-obtain-another-token)

<!-- /TOC -->

<details>
<summary>Last verified on Oct 16, 2026 — ✅ Success</summary>

| # | Date | Confirmed Working |
|---|---|---|
| 1 | Oct 16, 2026 | Procedure prepared against v1.12.48 source |
| 2 | Oct 16, 2026 | ✅ User confirmed Step 1 token issuance succeeded with HTTP 200 and Step 2 access-token replay was rejected with HTTP 400 |

The user confirmed that both steps worked. The result blocks remain selected, source-derived examples rather than captured command output. Additional diagnostics, variable response fields, decoded JWT objects, and raw token output are omitted from the examples. The helpers print complete non-sensitive diagnostics to stderr and issued access tokens to stdout. This page checks API access-token audience validation; it does not establish full caller-binding coverage for PR #3499 or single-use enforcement for valid ZTS-audience assertions.

</details>

# Prerequisites

1. Complete the main [ID-JAG The Hard Way tutorial](https://github.com/mlajkim/id-jag-the-hard-way/tree/main/tutorials), including the learner identity and `api:role.docs-getter` membership in [Granular Permission](../../../tutorials/07-granular-permission.md)
1. Keep the local Kubernetes cluster and `./tools/keep-k8s-port-forward.sh` running, with Bash, `kubectl`, `curl`, `jq`, and `openssl` available, together with the [version-switch prerequisites](../../../tools/README.md#switching-the-local-athenz-version)
1. Run each command block with Bash from the IDTHW repository root, using the existing learner service key at `./keys/idjag-learner.key` for key ID `v1`; run Steps 1 and 2 in the same Bash session

This page follows the setup and token-acquisition flow in [261010](./261010-jwt-client-assertion-audience-validation.md), using the release that includes the fix in [PR #3499](https://github.com/AthenZ/athenz/pull/3499).

# Steps

## Setup 1. Select Athenz v1.12.48 or newer

Check that the running ZTS version is `1.12.48` or newer. If this passes, continue to Setup 2.

```sh
./tools/athenz/athenz-version-verifier.sh 1.12.48
```

```sh
#   ·  Checking Athenz ZTS version (minimum: 1.12.48, namespace: athenz)...
#   ✔  <zts-pod>: 1.12.48 meets the minimum 1.12.48
#   ✔  Athenz ZTS version check passed
```

If the verifier reports an older version (exit `1`), select v1.12.48. The version-switch helper applies the required SQL migrations and preserves the existing database. The result below is the expected final line. If the version cannot be verified (exit `2`), resolve that error first. Record the reported version if using a later release.

```sh
make athenz-vup VERSION=1.12.48
```

```sh
#   ✔  Athenz 1.12.48 is running; the existing database was preserved
```

## Setup 2. Refresh the learner service certificate

Refresh the service certificate for `human.idjag-learner` once here, using the existing private key for key ID `v1`, as in 261010. The command saves it to `./keys/idjag-learner.crt`. A still-valid certificate would also work. The RFC 7523 requests below use signed assertions without a client certificate.

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

Sign a fresh five-minute assertion as `human.idjag-learner` and submit it to ZTS as an RFC 7523 JWT bearer authorization grant, as in 261010. The signer discovers the running ZTS issuer and uses it as `aud`. The fetch helper sends the signed JWT as `assertion` and `api:role.docs-getter` as the HTTP `scope` parameter, then returns the access token. Save it in `_api_access_token` for Step 2.

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

## Step 2. Get rejected when replaying the access token to obtain another token

Suppose the API server, or someone who obtains the Bearer token from Step 1, tries to reuse it to get another access token from ZTS. Possessing that token does not prove possession of the learner's private key. Its `aud=api` permits use at the API; it does not identify ZTS as the intended recipient for client authentication or an RFC 7523 grant. PR #3499 adds the audience validation that rejects this reuse.

Submit `_api_access_token` saved in Step 1 to ZTS as an RFC 7523 `assertion`. This attempts to obtain another access token using the issued API access token. Use the same fetch helper as Step 1. It prints the ZTS response and exits nonzero when token issuance is rejected.

```sh
./tools/athenz/fetch-access-token-with-rfc7523.sh \
  "${_api_access_token}" api:role.docs-getter
```

```sh
#   ·  Requesting an access token (jwt-bearer)...
#   ·  ZTS response (HTTP 400; credential values redacted):
# {
#   "code": 400,
#   "message": "Invalid client assertion: audience api does not identify the token endpoint"
# }
#   ✘  Expected HTTP 200, received 400
```

On the fixed release, ZTS rejects this request with HTTP `400` because the token's `aud=api` does not identify the token endpoint. The error text comes from the ZTS response.

# Reference

- [Athenz v1.12.48](https://github.com/AthenZ/athenz/releases/tag/v1.12.48)
- [PR #3499 — Validate audience and caller binding for JWT client assertions](https://github.com/AthenZ/athenz/pull/3499)
- [AccessTokenRequest.java at v1.12.48](https://github.com/AthenZ/athenz/blob/v1.12.48/servers/zts/src/main/java/com/yahoo/athenz/zts/token/AccessTokenRequest.java)
- [ZTSImplClientAssertionIdTokenReplayTest at v1.12.48](https://github.com/AthenZ/athenz/blob/v1.12.48/servers/zts/src/test/java/com/yahoo/athenz/zts/ZTSImplClientAssertionIdTokenReplayTest.java)
- [261010 — v1.12.47 comparison](./261010-jwt-client-assertion-audience-validation.md)
- [RFC 7523 JWT bearer authorization grant baseline](./260813-rfc7523-jwt-bearer-authorization-grant.md)
