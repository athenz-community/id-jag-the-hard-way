# Goal

The goal of this document is to use the RFC 7523 JWT bearer authorization grant to exchange a service-signed JWT assertion for an Athenz access token without presenting an X.509 client certificate to ZTS, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Confirm the existing service key and role](#step-1-confirm-the-existing-service-key-and-role)
- [Step 2. Create, sign, and inspect the RFC 7523 assertion](#step-2-create-sign-and-inspect-the-rfc-7523-assertion)
- [Step 3. Exchange the assertion for an access token](#step-3-exchange-the-assertion-for-an-access-token)
- [Step 4. Use the access token](#step-4-use-the-access-token)

<!-- /TOC -->

<details>
<summary>Last human verified on Aug 13, 2026 — ✅ Success</summary>

| # | Date         | Confirmed Working                                      |
|---|--------------|--------------------------------------------------------|
| 1 | Aug 13, 2026 | ✅ Human verified — complete RFC 7523 access-token flow |

</details>

# Prerequisites

This tutorial requires the following to be completed:

- Complete the main [ID-JAG The Hard Way tutorial](../../../tutorials/16-id-jag.md), including the final ID-JAG step.
- Keep the tutorial's Kubernetes cluster and `./tools/keep-k8s-port-forward.sh` running.
- Use Athenz v1.12.42 or later.
- Have `curl`, `jq`, and `openssl` available.
- Run all commands from the ID-JAG The Hard Way repository root.

# Steps

Here is the procedure to get to the goals.

RFC 7523 defines how a client can present a signed JWT as an OAuth 2.0 authorization grant. In this flow, the private key remains with `human.idjag-learner`; only the short-lived signed assertion is sent to ZTS.

```mermaid
flowchart LR
  Key["human.idjag-learner private key"]
  Assertion["Signed JWT assertion"]
  ZTS["Athenz ZTS token endpoint"]
  Token["Athenz access token"]
  API["Protected API"]

  Key -->|sign locally| Assertion
  Assertion -->|RFC 7523 jwt-bearer grant| ZTS
  ZTS -->|Bearer token| Token
  Token -->|Authorization: Bearer| API
```

[Athenz PR #3377](https://github.com/AthenZ/athenz/pull/3377) is the implementation history for this test. Before the change, ZTS routed the `jwt-bearer` grant to its ID-JAG path. Athenz v1.12.42 and later inspect the assertion type: `oauth-id-jag+jwt` continues through the ID-JAG path, while a standard service-signed JWT goes through the RFC 7523 access-token path.

## Step 1. Confirm the existing service key and role

The completed tutorial already registers the `human.idjag-learner` public key under key ID `v1`. Confirm it instead of creating another service:

```sh
./tools/athenz/show-service.sh human idjag-learner
```

```sh
#   ·  Showing service human.idjag-learner...
# {
#   "name": "human.idjag-learner",
#   "publicKeys": [
#     {
#       "key": "<redacted public key>",
#       "id": "v1"
#     }
#   ],
#   "modified": "..."
# }
```

Confirm the same principal belongs to `api:role.docs-getter`, which will be the requested OAuth scope:

```sh
./tools/athenz/show-principal-roles.sh human.idjag-learner api
```

```sh
# {
#   "memberName": "human.idjag-learner",
#   "memberRoles": [
#     {
#       "roleName": "docs-getter",
#       "domainName": "api"
#     },
#     ...
#   ]
# }
```

The private key at `./keys/idjag-learner.key` matches the registered `v1` public key. The private key is used locally in Step 2 and is never sent to ZTS.

## Step 2. Create, sign, and inspect the RFC 7523 assertion

Set the assertion identity, ZTS audience, and requested scope, then create a one-hour assertion with the shared RFC 7523 tool:

```sh
_principal='human.idjag-learner'
_audience='https://athenz-zts-server.athenz:4443/zts/v1'
_scope='api:role.docs-getter'

_assertion=$(
  ./tools/athenz/create-rfc7523-assertion.sh \
    --principal "${_principal}" \
    --private-key ./keys/idjag-learner.key \
    --key-id v1 \
    --audience "${_audience}" \
    --scope "${_scope}" \
    --expires-in 3600
)
```

```sh
#   ·  Creating RFC 7523 JWT assertion for human.idjag-learner...
#   ✔  RFC 7523 JWT assertion signed with key ID v1 (expires in 3600 seconds)
# {
#   "header": {
#     "alg": "RS256",
#     "typ": "at+jwt",
#     "kid": "v1"
#   },
#   "payload": {
#     "iss": "human.idjag-learner",
#     "sub": "human.idjag-learner",
#     "aud": "https://athenz-zts-server.athenz:4443/zts/v1",
#     "scope": "api:role.docs-getter",
#     "iat": ...,
#     "exp": ...
#   }
# }
```

The helper prints the formatted header and payload to the terminal while command substitution stores only the compact JWT in `_assertion`. The tool creates the claims, converts the header and payload to Base64URL, signs them with RS256, and prints the compact assertion to stdout. RFC 7523 uses `iss`, `sub`, `aud`, and `exp` to identify the issuer, subject, intended authorization server, and expiry. The tool also puts the requested Athenz role in the assertion's `scope` claim. `kid=v1` tells ZTS which registered public key must verify the signature. The private key never leaves the workstation.

The assertion is self-issued: `iss` equals `sub`. The audience binds it to this ZTS deployment, the expiry limits how long it can be replayed, and the signature proves possession of the registered `human.idjag-learner` private key.

> [!NOTE]
> RFC 7523 does not require `typ=at+jwt`. This test uses the type from Athenz's #3377 end-to-end test. ZTS distinguishes it from `oauth-id-jag+jwt`, which remains reserved for the ID-JAG path.

## Step 3. Exchange the assertion for an access token

Exchange the signed assertion for an access token. The helper sends no client certificate or private key to ZTS; ZTS authenticates the service by verifying the assertion signature with the registered `v1` public key:

```sh
_access_token=$(
  ./tools/athenz/fetch-access-token-with-rfc7523.sh "${_assertion}"
)
```

```sh
#   ·  Exchanging RFC 7523 JWT assertion for an access token...
#   ✔  Access token issued through the RFC 7523 JWT bearer grant
# eyJraWQiOiJhdGhlbnotenRzLXNlcnZlci02Yzc5Y2JkNmNjLWx4cW10IiwidHlwIjoiYXQrand0IiwiYWxnIjoiUlMyNTYifQ.eyJzdWIiOiJodW1hbi5pZGphZy1sZWFybmVyIiwiYXVkIjoiYXBpIiwic2NwIjpbImRvY3MtZ2V0dGVyIl0sInVpZCI6Imh1bWFuLmlkamFnLWxlYXJuZXIiLCJ2ZXIiOjEsImF1dGhfdGltZSI6MTc4NjYwOTc5NCwic2NvcGUiOiJkb2NzLWdldHRlciIsImlzcyI6ImF0aGVuei16dHMtc2VydmVyLTZjNzljYmQ2Y2MtbHhxbXQiLCJleHAiOjE3ODY2MTY5OTQsImlhdCI6MTc4NjYwOTc5NCwianRpIjoiNGRkMWE0ZjItZGVmMC00OWRjLTg1ZWUtYjlhYjNkNDNjNzNjIiwiY2xpZW50X2lkIjoiaHVtYW4uaWRqYWctbGVhcm5lciJ9.uItw2JvUtPE7vs4m9XJnXKqrCi2uBxvxB6pnMuehsFRlzV2YeMPerKIppCZ9gs-10v3TmBScMf0Q-vcShCRRF0dyeXqGCarT1FCwYuko7TjRFhP6Bx9FVo92kLnzj_paYCg_jyMaq-EmvqO7o9EGD8m6qZWlj31_VqDxM0PC8mIUWANh8S6Mu523s6cwd2BbLTxr1EzLAs2AUdU7KGbsm4d_vp_2c1JsluwGKgxjs21e5KurQ7kB--lgeIEc2JzYiXXdrWk7ZKl-bDveekFGYGD7X5PMDpsIUsnH0EeK8Og16fpFpgS7ORQvhaP6eF8xEg1K-cBr4-I7AxDIIBD_LdRwtXX3nKiayDe0MmNr4TSCyCF3Pu98KTLU7S9ykVflJtRD_XeOHZkZAqP2PkYRVgy8UCf9st59oXKsf6pW1mrWzo6eXgT0mINF3YjzViZbvIiUkZESfihUt3RT797JQrIan9mG-JBfWLLi56e6BIlEZ8cbEv8NLD1LKpxtb4vKYW_lG5K8yqNDj_W2sokn8ralwqS-iO5HPMOrvQLg1ezNimcMD1aDficSTygRGSJoXAbrpKKBqvZ0zT5Mu3FNCnxRXGAy-c71t5u7dJcVeP2OtENSL5IUbP-J8-lAHwZhWa6IyI4YfmC-CGV37nICLlxuRtP5VM6RWo5NQ2F1_lg
# {
#   "header": {
#     "typ": "at+jwt",
#     "alg": "RS256"
#   },
#   "claims": {
#     "sub": "human.idjag-learner",
#     "client_id": "human.idjag-learner",
#     "aud": "api",
#     "scp": [
#       "docs-getter"
#     ],
#     "scope": "docs-getter"
#   }
# }
```

The helper displays the issued access token and its decoded details on stderr while command substitution stores the same raw token from stdout in `_access_token`.

## Step 4. Use the access token

Use the token to call the protected tutorial API:

```sh
curl -skS \
  -H "Authorization: Bearer ${_access_token}" \
  "http://localhost:$(./tools/port.sh api-server)/api/docs" \
  | jq
```

```sh
# {
#   "docs": [
#     {
#       "name": "first default doc",
#       "id": 1,
#       "content": "hello world"
#     },
#     {
#       "name": "second default doc",
#       "id": 2,
#       "content": "how are you?"
#     }
#   ]
# }
```

This proves the full standard-based path: a locally signed JWT assertion authenticated the service to ZTS, ZTS issued an Athenz Bearer access token for the authorized scope, and the protected API accepted that token.

# Reference

- [RFC 7523 — JSON Web Token (JWT) Profile for OAuth 2.0 Client Authentication and Authorization Grants](https://www.rfc-editor.org/rfc/rfc7523.html)
- [RFC 7519 — JSON Web Token](https://www.rfc-editor.org/rfc/rfc7519.html)
- [Athenz PR #3377 — support fetching access tokens based on RFC 7523](https://github.com/AthenZ/athenz/pull/3377)
