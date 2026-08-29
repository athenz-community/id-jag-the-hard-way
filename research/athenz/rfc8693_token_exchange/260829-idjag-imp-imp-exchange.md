# Goal

The goal of this document is to reproduce an ID-JAG impersonation→impersonation sequence and observe how the subject is preserved without creating an actor chain, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Setup 1. Create the mcp-hub roles](#setup-1-create-the-mcp-hub-roles)
- [Setup 2. Create the mcp-hub service identity](#setup-2-create-the-mcp-hub-service-identity)
- [Setup 3. Allow mcp-hub to use api tokens as exchange input](#setup-3-allow-mcp-hub-to-use-api-tokens-as-exchange-input)
- [Setup 4. Allow mcp-hub to exchange into the requested scopes](#setup-4-allow-mcp-hub-to-exchange-into-the-requested-scopes)
- [Step 1. Fetch an id_token](#step-1-fetch-an-id_token)
- [Step 2. Exchange the id_token for ID_JAG](#step-2-exchange-the-id_token-for-id_jag)
- [Step 3. Issue the initial impersonation AT](#step-3-issue-the-initial-impersonation-at)
- [Step 4. Exchange the AT by impersonation again](#step-4-exchange-the-at-by-impersonation-again)
- [Clean-up 5. Delete temporary test resources](#clean-up-5-delete-temporary-test-resources)

<!-- /TOC -->

<details>
<summary>Last verified on Aug 29, 2026 — ✅ Success</summary>

| # | Date         | Confirmed Working                                                                                                                          |
|---|--------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | Aug 29, 2026 | ✅ — both impersonation ATs issued; subject remained the human; second AT was bound to the mcp-hub certificate without an actor chain |
| 2 | Aug 29, 2026 | ✅ — manually reran the complete token flow and confirmed the same claim transformation                                                    |

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
#   "exp": 1787983096,
#   "iat": 1787968696,
#   "jti": "63a68725-5908-86a9-4077-8305e288a037",
#   "iss": "http://localhost:34443/realms/master",
#   "aud": "human.idjag-learner.claude",
#   "sub": "3b1ebc43-f64d-446f-a388-b0431801fe57",
#   "typ": "ID",
#   "azp": "human.idjag-learner.claude",
#   "sid": "aprU5LypLEKiBpBh9wD0XMmq",
#   "at_hash": "BDj2nnSFNrSgq6g3S77wbw",
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
#   "auth_time": 1787968701,
#   "scope": "api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor",
#   "iss": "https://athenz-zts-server.athenz:4443/zts/v1",
#   "exp": 1787975901,
#   "iat": 1787968701,
#   "jti": "ca20dca6-0c25-4c3f-af40-dac9ccdc7710",
#   "client_id": "human.idjag-learner.claude"
# }
```

## Step 3. Issue the initial impersonation AT

Omit `actor` from the ID-JAG→AT request:

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
#   "auth_time": 1787968706,
#   "scope": "docs-getter mcp-accessor mcp-hub-accessor",
#   "iss": "athenz-zts-server-6f45c67fff-49w2g",
#   "exp": 1787990306,
#   "iat": 1787968706,
#   "jti": "22c9ea0f-fa3d-4265-92bb-899d471b82da",
#   "client_id": "human.idjag-learner.claude"
# }
```

The initial AT has no `act`, `may_act`, or `cnf` claim.

## Step 4. Exchange the AT by impersonation again

Use the `api.mcp-hub` certificate and omit `actor_token`:

```sh
_next_scope="api:role.docs-getter api:role.mcp-accessor"

_next_at=$(./tools/athenz/exchange-access-token.sh \
  ./keys/api-mcp-hub.crt \
  ./keys/api-mcp-hub.key \
  "$_first_at" \
  "$_next_scope" \
  --token-only)
```

```sh
#   ·  Exchanging access token for scope: api:role.docs-getter api:role.mcp-accessor
#   ✔  Access token exchanged for scope: api:role.docs-getter api:role.mcp-accessor
# {
#   "kid": "athenz-zts-server-6f45c67fff-49w2g",
#   "typ": "at+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "docs-getter",
#     "mcp-accessor"
#   ],
#   "ver": 1,
#   "iss": "athenz-zts-server-6f45c67fff-49w2g",
#   "client_id": "api.mcp-hub",
#   "aud": "api",
#   "uid": "api.mcp-hub",
#   "auth_time": 1787968713,
#   "scope": "docs-getter mcp-accessor",
#   "cnf": {
#     "x5t#S256": "d2BgmmB-LQLOlsAgH91zMb_pUJAlvXEpZfuObnYIEew"
#   },
#   "exp": 1787972313,
#   "iat": 1787968713,
#   "jti": "a8475816-a1ea-4ad9-9f6b-6ff51618b7b6"
# }
```

The second impersonation preserves `sub`, changes `client_id` and `uid` to `api.mcp-hub`, keeps `act` and `may_act` absent, and adds `cnf.x5t#S256` for the mcp-hub certificate.

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
- [Athenz `processAccessTokenImpersonationRequest`](../../../athenz_dist/athenz/servers/zts/src/main/java/com/yahoo/athenz/zts/ZTSImpl.java)
