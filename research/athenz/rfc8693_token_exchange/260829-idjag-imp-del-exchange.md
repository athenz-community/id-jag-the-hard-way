# Goal

The goal of this document is to reproduce the rejected ID-JAG impersonation→delegation sequence and confirm that an impersonation AT cannot start native delegation without `may_act`, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Setup 1. Create the mcp-hub roles](#setup-1-create-the-mcp-hub-roles)
- [Setup 2. Create the mcp-hub service identity](#setup-2-create-the-mcp-hub-service-identity)
- [Setup 3. Allow mcp-hub to use api tokens as exchange input](#setup-3-allow-mcp-hub-to-use-api-tokens-as-exchange-input)
- [Setup 4. Allow mcp-hub to exchange into the requested scopes](#setup-4-allow-mcp-hub-to-exchange-into-the-requested-scopes)
- [Step 1. Fetch an id_token](#step-1-fetch-an-id_token)
- [Step 2. Exchange the id_token for ID_JAG](#step-2-exchange-the-id_token-for-id_jag)
- [Step 3. Issue the initial impersonation AT](#step-3-issue-the-initial-impersonation-at)
- [Step 4. Attempt a delegated exchange](#step-4-attempt-a-delegated-exchange)
- [Clean-up 5. Delete temporary test resources](#clean-up-5-delete-temporary-test-resources)

<!-- /TOC -->

<details>
<summary>Last verified on Aug 29, 2026 — ✅ Expected failure confirmed</summary>

| # | Date         | Confirmed Working                                                                                                                |
|---|--------------|----------------------------------------------------------------------------------------------------------------------------------|
| 1 | Aug 29, 2026 | ✅ — impersonation AT issued without `may_act`; 👍 subsequent delegated exchange was rejected with `missing may_act claim` |

</details>

# Prerequisites

Complete [16-id-jag.md](../../../tutorials/16-id-jag.md) before starting this procedure.

# Steps

Here is the complete procedure. Run all commands from the repository root in the same shell.

## Setup 1. Create the mcp-hub roles

Create the first-hop access role and allow the Claude service to exchange ID_JAG into it:

```sh
./tools/athenz/create-role.sh api mcp-hub-accessor
./tools/athenz/add-role-member.sh api mcp-hub-accessor human.idjag-learner
./tools/athenz/create-role.sh api mcp-hub-accessor-jag-exchanger
./tools/athenz/add-policy.sh api mcp-hub-accessor-jag-exchanger zts.jag_exchange role.mcp-hub-accessor
./tools/athenz/add-role-member.sh api mcp-hub-accessor-jag-exchanger human.idjag-learner.claude
```

## Setup 2. Create the mcp-hub service identity

```sh
./tools/athenz/create-private-key.sh ./keys/api-mcp-hub
./tools/athenz/create-service.sh api mcp-hub ./keys/api-mcp-hub.public.key
./tools/athenz/enable-cert-provider.sh api mcp-hub
./tools/athenz/fetch-cert.sh api mcp-hub ./keys/api-mcp-hub.key v1
```

## Setup 3. Allow mcp-hub to use api tokens as exchange input

```sh
./tools/athenz/add-role-member.sh api to-api-exchanger api.mcp-hub
```

## Setup 4. Allow mcp-hub to exchange into the requested scopes

```sh
./tools/athenz/create-role.sh api mcp-accessor-exchanger
./tools/athenz/add-policy.sh api mcp-accessor-exchanger zts.token_target_exchange api:role.mcp-accessor
./tools/athenz/add-role-member.sh api mcp-accessor-exchanger api.mcp-hub
./tools/athenz/add-role-member.sh api docs-getter-exchanger api.mcp-hub
```

## Step 1. Fetch an id_token

```sh
./tools/keycloak/set-direct-access-grants.sh human.idjag-learner.claude true
_client_secret=$(./tools/keycloak/get-client-secret.sh human.idjag-learner.claude)
_id_token=$(./tools/keycloak/get-id-token.sh human.idjag-learner.claude "$_client_secret" idjag-learner)
```

```sh
#   ·  Fetching Keycloak admin token
#   ·  Looking up UUID for client human.idjag-learner.claude
#   ·  Fetching client human.idjag-learner.claude
#   ·  Setting Direct Access Grants for human.idjag-learner.claude: true
#   ✔  Direct Access Grants set for human.idjag-learner.claude: true
#   ·  Fetching Keycloak admin token
#   ·  Looking up UUID for client human.idjag-learner.claude
#   ·  Fetching client secret for human.idjag-learner.claude
#   ·  Fetching id_token from Keycloak for Keycloak username: idjag-learner, client: human.idjag-learner.claude
#   ✔  id_token issued for Keycloak username: idjag-learner
# {
#   "alg": "RS256",
#   "typ": "JWT",
#   "kid": "jio8OS-7FzKy8UfOCol-zj1946k1y1JyC6Z6D676WKc"
# }
# {
#   "exp": 1787982693,
#   "iat": 1787968293,
#   "jti": "eab17664-91fc-7024-2849-9f11467d78da",
#   "iss": "http://localhost:34443/realms/master",
#   "aud": "human.idjag-learner.claude",
#   "sub": "3b1ebc43-f64d-446f-a388-b0431801fe57",
#   "typ": "ID",
#   "azp": "human.idjag-learner.claude",
#   "sid": "9AjhInFimHLWSPnUaTbtXxH5",
#   "at_hash": "I1DJU8RTCb0Rhjzosc2pJg",
#   "acr": "1",
#   "email_verified": false,
#   "name": "ID-JAG Learner",
#   "preferred_username": "idjag-learner",
#   "given_name": "ID-JAG",
#   "family_name": "Learner",
#   "email": "idjag-learner@athenz.io"
# }
```

## Step 2. Exchange the id_token for ID_JAG

```sh
_id_jag_scope="api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor"

_id_jag=$(./tools/athenz/fetch-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_id_token" \
  "$_id_jag_scope")
```

```sh
#   ·  Exchanging id_token for ID_JAG (scope: api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor)
#   ✔  ID_JAG issued (scope: api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor)
# {
#   "kid": "athenz-zts-server-6f45c67fff-49w2g",
#   "typ": "oauth-id-jag+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "aud": "https://athenz-zts-server.athenz:4443/zts/v1",
#   "scp": [
#     "api:role.docs-getter",
#     "api:role.mcp-accessor",
#     "api:role.mcp-hub-accessor"
#   ],
#   "ver": 1,
#   "auth_time": 1787968297,
#   "scope": "api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor",
#   "iss": "https://athenz-zts-server.athenz:4443/zts/v1",
#   "exp": 1787975497,
#   "iat": 1787968297,
#   "jti": "843ad90b-a719-4773-8c5d-0b52bb7b603a",
#   "client_id": "human.idjag-learner.claude"
# }
```

## Step 3. Issue the initial impersonation AT

Omit `actor` so the ID-JAG→AT request uses impersonation semantics:

```sh
_first_scope="api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor"

_first_at=$(./tools/athenz/fetch-access-token-with-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_id_jag" \
  "$_first_scope")
```

```sh
#   ·  Fetching Access Token with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor
#   ✔  Access token issued with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor
# {
#   "kid": "athenz-zts-server-6f45c67fff-49w2g",
#   "typ": "at+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "aud": "api",
#   "scp": [
#     "docs-getter",
#     "mcp-accessor",
#     "mcp-hub-accessor"
#   ],
#   "uid": "human.idjag-learner",
#   "ver": 1,
#   "auth_time": 1787968320,
#   "scope": "docs-getter mcp-accessor mcp-hub-accessor",
#   "iss": "athenz-zts-server-6f45c67fff-49w2g",
#   "exp": 1787989920,
#   "iat": 1787968320,
#   "jti": "66533bc6-5cfe-47d5-98dc-9bbf29f4eeb5",
#   "client_id": "human.idjag-learner.claude"
# }
```

The initial AT has no `act`, `may_act`, or `cnf` claim.

## Step 4. Attempt a delegated exchange

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
#   "auth_time": 1787968347,
#   "iss": "https://athenz-zts-server.athenz:4443/zts/v1",
#   "exp": 1788011547,
#   "iat": 1787968347,
#   "nonce": "random_nonce"
# }
#   ·  Exchanging access token for scope: api:role.docs-getter api:role.mcp-accessor
# {
#   "code": 400,
#   "message": "Invalid subject token: missing may_act claim"
# }
```

The actor token is valid, but delegation is rejected because the subject AT was issued without `may_act`.

## Clean-up 5. Delete temporary test resources

```sh
./tools/athenz/delete-role-member.sh api to-api-exchanger api.mcp-hub
./tools/athenz/delete-role-member.sh api docs-getter-exchanger api.mcp-hub
./tools/athenz/delete-assertion.sh api zts_instance_launch_provider grant launch zts_instance_launch_provider service.mcp-hub
./tools/athenz/delete-service.sh api mcp-hub
./tools/athenz/delete-policy.sh api mcp-hub-accessor-jag-exchanger_zts_jag_exchange_role_mcp-hub-accessor
./tools/athenz/delete-role.sh api mcp-hub-accessor-jag-exchanger
./tools/athenz/delete-policy.sh api mcp-accessor-exchanger_zts_token_target_exchange_api_role_mcp-accessor
./tools/athenz/delete-role.sh api mcp-accessor-exchanger
./tools/athenz/delete-role.sh api mcp-hub-accessor
```

# Reference

- [RFC 8693 — Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693)
- [Athenz `AccessTokenRequest.validateActorToken`](../../../athenz_dist/athenz/servers/zts/src/main/java/com/yahoo/athenz/zts/token/AccessTokenRequest.java)
