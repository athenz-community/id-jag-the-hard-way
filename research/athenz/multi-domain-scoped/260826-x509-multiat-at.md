# Goal

The goal of this document is to use an X.509 identity to obtain one access token containing roles from the isolated `mcp-hub.multi-scoped` and `api.multi-scoped` domains, exchange it into only the `api.multi-scoped` permission, and prove that exchange cannot add an undelegated scope, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Setup 1. Create the isolated domains and access roles](#setup-1-create-the-isolated-domains-and-access-roles)
- [Setup 2. Authorize cross-domain token exchange](#setup-2-authorize-cross-domain-token-exchange)
- [Step 1. Obtain the learner X.509 identity](#step-1-obtain-the-learner-x509-identity)
- [Step 2. Request one access token for both domains](#step-2-request-one-access-token-for-both-domains)
- [Step 3. Downscope the token to api.multi-scoped](#step-3-downscope-the-token-to-apimulti-scoped)
- [Step 4. Verify that exchange cannot add a missing scope](#step-4-verify-that-exchange-cannot-add-a-missing-scope)
- [Clean-up 5. Remove the test-only Athenz resources](#clean-up-5-remove-the-test-only-athenz-resources)

<!-- /TOC -->

<details>
<summary>Last verified on Aug 26, 2026 — ✅ Success</summary>

| # | Date         | Confirmed Working |
|---|--------------|-------------------|
| 1 | Aug 26, 2026 | ✅ — X.509 client-credentials request returned one `mcp-hub.multi-scoped` audience token containing both domain roles; AT-to-AT exchange retained only `api.multi-scoped:role.docs-getter` |
| 2 | Aug 26, 2026 | 👍 — exchange into `api.multi-scoped:role.docs-deleter`, which was absent from the subject token, failed with code 400, `Invalid scope for token exchange` |

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete the main [ID-JAG The Hard Way tutorial](../../../tutorials/16-id-jag.md).
1. Complete [Setup multi-domain-scoped ZTS](./260825-setup-multi-domain-scoped-zts.md), including `athenz.zts.access_token_max_domains=10`.

# Steps

Here is the procedure to get to the goals.

## Setup 1. Create the isolated domains and access roles

Create one isolated subdomain under each existing parent domain:

```sh
./tools/athenz/create-subdomain.sh mcp-hub multi-scoped
./tools/athenz/create-subdomain.sh api multi-scoped
```

```sh
#   ✔  Subdomain created: mcp-hub.multi-scoped
#   ✔  Subdomain created: api.multi-scoped
```

Create the Core MCP Proxy access role in the audience domain and add the learner:

```sh
./tools/athenz/create-role.sh \
  mcp-hub.multi-scoped core-mcp-proxy-accessors
./tools/athenz/add-role-member.sh \
  mcp-hub.multi-scoped core-mcp-proxy-accessors human.idjag-learner
```

```sh
#   ✔  Role created: mcp-hub.multi-scoped:role.core-mcp-proxy-accessors
#   ✔  human.idjag-learner  →  mcp-hub.multi-scoped:role.core-mcp-proxy-accessors
```

Create both target roles and add the learner. The multi-domain token requests only `docs-getter`; `docs-deleter` exists solely to prove that a later exchange cannot add an uncarried permission:

```sh
./tools/athenz/create-role.sh api.multi-scoped docs-getter
./tools/athenz/add-role-member.sh \
  api.multi-scoped docs-getter human.idjag-learner

./tools/athenz/create-role.sh api.multi-scoped docs-deleter
./tools/athenz/add-role-member.sh \
  api.multi-scoped docs-deleter human.idjag-learner
```

```sh
#   ✔  Role created: api.multi-scoped:role.docs-getter
#   ✔  human.idjag-learner  →  api.multi-scoped:role.docs-getter
#   ✔  Role created: api.multi-scoped:role.docs-deleter
#   ✔  human.idjag-learner  →  api.multi-scoped:role.docs-deleter
```

The principal must be authorized for at least one requested role in every scope domain. If several roles are requested from one domain, ZTS may omit unauthorized roles as long as another authorized role remains in that domain; if a domain contributes no role, the entire request fails. A multi-domain token request does not bypass ordinary role authorization.

## Setup 2. Authorize cross-domain token exchange

AT-to-AT exchange across domains requires two independent permissions:

1. The source domain permits use of an `mcp-hub.multi-scoped` token as exchange input for the `api.multi-scoped` target.
1. The target domain permits exchange from `mcp-hub.multi-scoped` into `api.multi-scoped:role.docs-getter`.

Create the source-exchange permission. `add-policy.sh` prefixes its domain, so the assertion resource becomes `mcp-hub.multi-scoped:api.multi-scoped`:

```sh
./tools/athenz/create-role.sh \
  mcp-hub.multi-scoped to-api-exchanger
./tools/athenz/add-policy.sh \
  mcp-hub.multi-scoped to-api-exchanger \
  zts.token_source_exchange api.multi-scoped
./tools/athenz/add-role-member.sh \
  mcp-hub.multi-scoped to-api-exchanger human.idjag-learner
```

```sh
#   ✔  Role created: mcp-hub.multi-scoped:role.to-api-exchanger
#   ✔  Policy created: mcp-hub.multi-scoped:policy.to-api-exchanger_zts_token_source_exchange_api_multi-scoped
#   ✔  human.idjag-learner  →  mcp-hub.multi-scoped:role.to-api-exchanger
```

Create the target-exchange permission. Its assertion resource becomes `api.multi-scoped:mcp-hub.multi-scoped:role.docs-getter`, explicitly tying this permission to tokens whose source audience is `mcp-hub.multi-scoped`:

```sh
./tools/athenz/create-role.sh \
  api.multi-scoped docs-getter-from-mcp-hub-exchanger
./tools/athenz/add-policy.sh \
  api.multi-scoped docs-getter-from-mcp-hub-exchanger \
  zts.token_target_exchange \
  mcp-hub.multi-scoped:role.docs-getter
./tools/athenz/add-role-member.sh \
  api.multi-scoped docs-getter-from-mcp-hub-exchanger human.idjag-learner
```

```sh
#   ✔  Role created: api.multi-scoped:role.docs-getter-from-mcp-hub-exchanger
#   ✔  Policy created: api.multi-scoped:policy.docs-getter-from-mcp-hub-exchanger_zts_token_target_exchange_mcp-hub_multi-scoped_role_docs-getter
#   ✔  human.idjag-learner  →  api.multi-scoped:role.docs-getter-from-mcp-hub-exchanger
```

These resource shapes match the branch's cross-domain token-exchange tests: source authorization is checked against `<source>:<target>`, and target authorization is checked against `<target>:<source>:role.<role>`.

## Step 1. Obtain the learner X.509 identity

Fetch or refresh the `human.idjag-learner` certificate. This flow begins with mTLS and does not use an ID-JAG token:

```sh
./tools/athenz/fetch-cert.sh \
  human idjag-learner ./keys/idjag-learner.key v1
```

```sh
#   ·  Fetching X.509 Certificate for human.idjag-learner...
#   ✔  Certificate saved to: ./keys/idjag-learner.crt
```

## Step 2. Request one access token for both domains

Request both roles and explicitly choose `mcp-hub.multi-scoped` as the audience:

```sh
_scope="mcp-hub.multi-scoped:role.core-mcp-proxy-accessors api.multi-scoped:role.docs-getter"

_multi_at=$(./tools/athenz/fetch-access-token.sh \
  ./keys/idjag-learner.crt \
  ./keys/idjag-learner.key \
  "$_scope" \
  --audience mcp-hub.multi-scoped)
```

```sh
#   ·  Fetching Access Token for scope: mcp-hub.multi-scoped:role.core-mcp-proxy-accessors api.multi-scoped:role.docs-getter...
#   ✔  Access token issued for scope: mcp-hub.multi-scoped:role.core-mcp-proxy-accessors api.multi-scoped:role.docs-getter
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "api.multi-scoped:role.docs-getter",
#     "core-mcp-proxy-accessors"
#   ],
#   "client_id": "human.idjag-learner",
#   "aud": "mcp-hub.multi-scoped",
#   "uid": "human.idjag-learner",
#   ...
# }
```

The audience-domain role is emitted as the short scope `core-mcp-proxy-accessors`. The role from the other domain remains fully qualified as `api.multi-scoped:role.docs-getter`; that qualification is what makes later cross-domain downscoping unambiguous.

If `--audience` is omitted when more than one domain is requested, ZTS rejects the request with `Multiple scope domains require an audience`. If the configured access-token domain limit is still `1`, it rejects the scope before issuance.

## Step 3. Downscope the token to api.multi-scoped

Use the learner certificate to authenticate the AT-to-AT exchange. No actor token is supplied, so this is the impersonation form of RFC 8693 exchange. Select only the fully qualified `api` role carried by the subject token:

```sh
_api_scope="api.multi-scoped:role.docs-getter"

_api_at=$(./tools/athenz/exchange-access-token.sh \
  ./keys/idjag-learner.crt \
  ./keys/idjag-learner.key \
  "$_multi_at" \
  "$_api_scope" \
  --audience api.multi-scoped \
  --token-only)
```

```sh
#   ·  Exchanging access token for scope: api.multi-scoped:role.docs-getter...
#   ✔  Access token exchanged for scope: api.multi-scoped:role.docs-getter
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "docs-getter"
#   ],
#   "client_id": "human.idjag-learner",
#   "aud": "api.multi-scoped",
#   "uid": "human.idjag-learner",
#   ...
# }
```

The output audience is now `api.multi-scoped`, so its role is represented as the short scope `docs-getter`. The unrelated `mcp-hub.multi-scoped` scope is absent.

## Step 4. Verify that exchange cannot add a missing scope

Try to exchange the same subject token into `api.multi-scoped:role.docs-deleter`. The learner is a member of that Athenz role, but `_multi_at` did not delegate it. The subject token is therefore the upper bound for the exchange:

```sh
./tools/athenz/exchange-access-token.sh \
  ./keys/idjag-learner.crt \
  ./keys/idjag-learner.key \
  "$_multi_at" \
  "api.multi-scoped:role.docs-deleter" \
  --audience api.multi-scoped
```

```sh
#   ·  Exchanging access token for scope: api.multi-scoped:role.docs-deleter...
# {
#   "code": 400,
#   "message": "Invalid scope for token exchange"
# }
```

This failure occurs during subset validation, before target-role exchange authorization. A role cannot be introduced merely because the subject or caller has that role outside the subject token.

## Clean-up 5. Remove the test-only Athenz resources

Keep the subdomains if this environment will continue to run the multi-domain manual tests. Otherwise, delete the isolated test domains; this also removes every role and policy created inside them without affecting the parent `mcp-hub` and `api` domains:

```sh
./tools/athenz/delete-domain.sh mcp-hub.multi-scoped
./tools/athenz/delete-domain.sh api.multi-scoped
```

# Reference

- [Athenz PR #3407 — Support scopes with domain names](https://github.com/AthenZ/athenz/pull/3407)
- [OAuth 2.0 Token Exchange (RFC 8693)](https://www.rfc-editor.org/rfc/rfc8693.html)
