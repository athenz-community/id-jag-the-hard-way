# Goal

The goal of this document is to reproduce the rejected X.509 impersonation→delegation sequence and confirm that an ordinary AT cannot start native delegation without `may_act`, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Setup 1. Refresh the learner certificate](#setup-1-refresh-the-learner-certificate)
- [Setup 2. Create the mcp-hub access role](#setup-2-create-the-mcp-hub-access-role)
- [Setup 3. Create the mcp-hub service identity](#setup-3-create-the-mcp-hub-service-identity)
- [Setup 4. Allow mcp-hub to use api tokens as exchange input](#setup-4-allow-mcp-hub-to-use-api-tokens-as-exchange-input)
- [Setup 5. Allow mcp-hub to exchange into the requested scopes](#setup-5-allow-mcp-hub-to-exchange-into-the-requested-scopes)
- [Step 1. Issue the initial ordinary AT](#step-1-issue-the-initial-ordinary-at)
- [Step 2. Attempt a delegated exchange](#step-2-attempt-a-delegated-exchange)
- [Clean-up 3. Delete temporary test resources](#clean-up-3-delete-temporary-test-resources)

<!-- /TOC -->

<details>
<summary>Last verified on Aug 29, 2026 — ✅ Expected failure confirmed</summary>

| # | Date         | Confirmed Working                                                                                                                      |
|---|--------------|----------------------------------------------------------------------------------------------------------------------------------------|
| 1 | Aug 29, 2026 | ✅ — certificate-bound ordinary AT issued without `may_act`; 👍 subsequent delegated exchange was rejected with `missing may_act claim` |

</details>

# Prerequisites

Complete [12-protect-mcp-server.md](../../../tutorials/12-protect-mcp-server.md) before starting this procedure.

# Steps

Here is the complete procedure. Run all commands from the repository root in the same shell.

## Setup 1. Refresh the learner certificate

```sh
./tools/athenz/fetch-cert.sh human idjag-learner ./keys/idjag-learner.key v1
```

## Setup 2. Create the mcp-hub access role

```sh
./tools/athenz/create-role.sh api mcp-hub-accessor
./tools/athenz/add-role-member.sh api mcp-hub-accessor human.idjag-learner
```

## Setup 3. Create the mcp-hub service identity

```sh
./tools/athenz/create-private-key.sh ./keys/api-mcp-hub
./tools/athenz/create-service.sh api mcp-hub ./keys/api-mcp-hub.public.key
./tools/athenz/enable-cert-provider.sh api mcp-hub
./tools/athenz/fetch-cert.sh api mcp-hub ./keys/api-mcp-hub.key v1
```

## Setup 4. Allow mcp-hub to use api tokens as exchange input

```sh
./tools/athenz/add-role-member.sh api to-api-exchanger api.mcp-hub
```

## Setup 5. Allow mcp-hub to exchange into the requested scopes

```sh
./tools/athenz/create-role.sh api mcp-accessor-exchanger
./tools/athenz/add-policy.sh api mcp-accessor-exchanger zts.token_target_exchange api:role.mcp-accessor
./tools/athenz/add-role-member.sh api mcp-accessor-exchanger api.mcp-hub
./tools/athenz/add-role-member.sh api docs-getter-exchanger api.mcp-hub
```

## Step 1. Issue the initial ordinary AT

Omit `actor` from the `client_credentials` request. This row calls the resulting direct AT “impersonation” only to preserve the eight-pattern naming matrix; the initial issuance is not itself RFC 8693 Token Exchange.

```sh
_first_scope="api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor"

_first_at=$(./tools/athenz/fetch-access-token.sh \
  ./keys/idjag-learner.crt \
  ./keys/idjag-learner.key \
  "$_first_scope")
```

```sh
#   ·  Fetching Access Token for scope: api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor
#   ✔  Access token issued for scope: api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor
# {
#   "kid": "athenz-zts-server-6f45c67fff-49w2g",
#   "typ": "at+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "docs-getter",
#     "mcp-accessor",
#     "mcp-hub-accessor"
#   ],
#   "ver": 1,
#   "iss": "athenz-zts-server-6f45c67fff-49w2g",
#   "client_id": "human.idjag-learner",
#   "aud": "api",
#   "uid": "human.idjag-learner",
#   "auth_time": 1787969025,
#   "scope": "docs-getter mcp-accessor mcp-hub-accessor",
#   "cnf": {
#     "x5t#S256": "BNoy6QE7zv6d6DlBYwhNkTSi27gggjdf-SlQ8FalMOA"
#   },
#   "exp": 1787972625,
#   "iat": 1787969025,
#   "jti": "3145f485-03a5-43cc-9390-168914ef1334"
# }
```

The initial AT is bound to the learner certificate and has no `act` or `may_act` claim.

## Step 2. Attempt a delegated exchange

Fetch the actor token for `api.mcp-hub`, then attempt delegation:

```sh
_mcp_hub_actor_id_token=$(./tools/athenz/fetch-actor-token.sh \
  ./keys/api-mcp-hub.crt \
  ./keys/api-mcp-hub.key \
  api.mcp-hub)

_next_scope="api:role.docs-getter api:role.mcp-accessor"

./tools/athenz/exchange-access-token.sh \
  ./keys/api-mcp-hub.crt \
  ./keys/api-mcp-hub.key \
  "$_first_at" \
  "$_next_scope" \
  --actor-token "$_mcp_hub_actor_id_token" \
  --actor api.api-mcp
```

```sh
#   ·  Fetching actor id_token from Athenz ZTS for client: api.mcp-hub
#   ✔  Actor id_token issued for client: api.mcp-hub
# {
#   "sub": "api.mcp-hub",
#   "aud": "api.mcp-hub",
#   "ver": 1,
#   "auth_time": 1787969035,
#   "iss": "https://athenz-zts-server.athenz:4443/zts/v1",
#   "exp": 1788012235,
#   "iat": 1787969035,
#   "nonce": "random_nonce"
# }
#   ·  Exchanging access token for scope: api:role.docs-getter api:role.mcp-accessor
# {
#   "code": 400,
#   "message": "Invalid subject token: missing may_act claim"
# }
```

The actor token is valid, but delegation is rejected because the subject AT was issued without `may_act`.

## Clean-up 3. Delete temporary test resources

```sh
./tools/athenz/delete-role-member.sh api to-api-exchanger api.mcp-hub
./tools/athenz/delete-role-member.sh api docs-getter-exchanger api.mcp-hub
./tools/athenz/delete-assertion.sh api zts_instance_launch_provider grant launch zts_instance_launch_provider service.mcp-hub
./tools/athenz/delete-service.sh api mcp-hub
./tools/athenz/delete-policy.sh api mcp-accessor-exchanger_zts_token_target_exchange_api_role_mcp-accessor
./tools/athenz/delete-role.sh api mcp-accessor-exchanger
./tools/athenz/delete-role.sh api mcp-hub-accessor
```

# Reference

- [RFC 8693 — Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693)
- [Athenz `AccessTokenRequest.validateActorToken`](../../../athenz_dist/athenz/servers/zts/src/main/java/com/yahoo/athenz/zts/token/AccessTokenRequest.java)
