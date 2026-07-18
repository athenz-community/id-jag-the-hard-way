# Goal

The goal of this document is to model a full X.509 delegated access-token exchange chain from `human.idjag-learner` to `mcp-hub`, then to `mcp`, then to the final API role, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Setup 1. Refresh the learner certificate](#setup-1-refresh-the-learner-certificate)
- [Setup 2. Create the mcp-hub access role](#setup-2-create-the-mcp-hub-access-role)
- [Setup 3. Create the mcp-hub service identity](#setup-3-create-the-mcp-hub-service-identity)
- [Setup 4. Allow mcp-hub to use api tokens as exchange input](#setup-4-allow-mcp-hub-to-use-api-tokens-as-exchange-input)
- [Setup 5. Allow mcp-hub to exchange into the mcp carry-forward scopes](#setup-5-allow-mcp-hub-to-exchange-into-the-mcp-carry-forward-scopes)
- [Step 1. Fetch a delegated mcp-hub access token with the learner certificate](#step-1-fetch-a-delegated-mcp-hub-access-token-with-the-learner-certificate)
- [Step 2. Fetch actor id_tokens for mcp-hub and mcp](#step-2-fetch-actor-id_tokens-for-mcp-hub-and-mcp)
- [Step 3. Reproduce the wrong actor token failure](#step-3-reproduce-the-wrong-actor-token-failure)
- [Step 4. Exchange from mcp-hub to mcp](#step-4-exchange-from-mcp-hub-to-mcp)
- [Step 5. Exchange from mcp to API](#step-5-exchange-from-mcp-to-api)
- [Clean-up 6. Delete temporary test resources](#clean-up-6-delete-temporary-test-resources)

<!-- /TOC -->

<details>
<summary>Last verified on Jul 10, 2026 — ✅ Success</summary>

| # | Date         | Confirmed Working                                                                                                                          |
|---|--------------|--------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | Jun 13, 2026 | 🟡 — setup tokens fetched; exchange missing `may_act` in output; second exchange not available in Athenz                                   |
| 2 | Jul 10, 2026 | ✅ — setup completed successfully as expected; 👍 wrong actor token failed as expected; ✅ mcp-hub to mcp and mcp to API exchanges succeeded |

</details>

# Prerequisites

This tutorial requires the following to be completed:

- [12-protect-mcp-server.md](../../../tutorials/12-protect-mcp-server.md)

# Steps

Here is the procedure to get to the goals. The setup sections create test-only Athenz objects; the core reproduction starts at Step 1.

Compared with the ID_JAG version, this X.509 flow does not need a `*-jag-exchanger` role because there is no ID_JAG exchange. It still needs `api:role.to-api-exchanger`, because `api.mcp-hub` later uses an existing `api` access token as the subject token in AT→AT exchange.

The intended delegated path is:

```mermaid
flowchart LR
  User["human.idjag-learner"]
  Hub["api.mcp-hub"]
  MCP["api.api-mcp"]
  API["api:role.docs-getter"]

  User -->|X.509 access token| Hub
  Hub -->|AT to AT exchange| MCP
  MCP -->|AT to AT exchange| API
```

## Setup 1. Refresh the learner certificate

Refresh the existing `human.idjag-learner` service certificate once, just in case the local certificate is missing or stale:

```sh
./tools/athenz/fetch-cert.sh human idjag-learner ./keys/idjag-learner.key v1
```

```sh
#   ·  Fetching X.509 Certificate for human.idjag-learner...
#   ✔  Certificate saved to: ./keys/idjag-learner.crt
```

## Setup 2. Create the mcp-hub access role

Create `api:role.mcp-hub-accessor` as the first-hop role for the hub. This is intentionally separate from `mcp-accessor`, which remains the role for the MCP layer.

```mermaid
flowchart LR
  User["human.idjag-learner"]
  HubAccessor["api:role.mcp-hub-accessor"]

  User -->|member of| HubAccessor
```

```sh
./tools/athenz/create-role.sh api mcp-hub-accessor
./tools/athenz/add-role-member.sh api mcp-hub-accessor human.idjag-learner
```

```sh
#   ✔  Role created: api:role.mcp-hub-accessor
#   ✔  human.idjag-learner  →  api:role.mcp-hub-accessor
```

## Setup 3. Create the mcp-hub service identity

Create the temporary `api.mcp-hub` service identity and fetch its service certificate:

```mermaid
flowchart LR
  PrivateKey["./keys/api-mcp-hub.key"]
  PublicKey["./keys/api-mcp-hub.public.key"]
  Service["api.mcp-hub"]
  Cert["./keys/api-mcp-hub.crt"]

  PrivateKey -->|key pair| PublicKey
  PublicKey -->|registered public key| Service
  Service -->|ZTS certificate provider| Cert
  PrivateKey -->|certificate request key| Cert
```

```sh
./tools/athenz/create-private-key.sh ./keys/api-mcp-hub
./tools/athenz/create-service.sh api mcp-hub ./keys/api-mcp-hub.public.key
./tools/athenz/enable-cert-provider.sh api mcp-hub
./tools/athenz/fetch-cert.sh api mcp-hub ./keys/api-mcp-hub.key v1
```

```sh
#   ·  Generating RSA key pair for: ./keys/api-mcp-hub...
#   ✔  Keys generated: ./keys/api-mcp-hub.key, ./keys/api-mcp-hub.public.key
#   ·  Registering Service: api.mcp-hub...
#   ✔  Service registered: api.mcp-hub
#   ·  Enabling ZTS Certificate Provider for api.mcp-hub...
#   ✔  ZTS Certificate Provider enabled for api.mcp-hub
#   ·  Fetching X.509 Certificate for api.mcp-hub...
#   ✔  Certificate saved to: ./keys/api-mcp-hub.crt
```

## Setup 4. Allow mcp-hub to use api tokens as exchange input

The base token-exchange tutorial already creates `api:role.to-api-exchanger` and grants it `zts.token_source_exchange` on the `api` domain. This role is still required in the X.509 flow: it controls who may use an existing `api` access token as the subject token in a token exchange.

For this research flow, add the temporary `api.mcp-hub` service as a member of that existing source-exchange role. Do not create or delete the `to-api-exchanger` role itself here; it belongs to the completed tutorial baseline.

```mermaid
flowchart LR
  Hub["api.mcp-hub"]
  SourceRole["api:role.to-api-exchanger"]
  SourceGrant["zts.token_source_exchange on api"]

  Hub -->|member of existing tutorial role| SourceRole
  SourceRole -->|already grants| SourceGrant
```

```sh
./tools/athenz/add-role-member.sh api to-api-exchanger api.mcp-hub
```

```sh
#   ✔  api.mcp-hub  →  api:role.to-api-exchanger
```

## Setup 5. Allow mcp-hub to exchange into the mcp carry-forward scopes

The mcp-hub to mcp exchange must keep `docs-getter` in the intermediate token, because a later token exchange can only request scopes that are still present in the subject token. Create the matching target-exchange role for `mcp-accessor`, then add temporary `api.mcp-hub` membership to the existing tutorial-owned `docs-getter-exchanger` role:

```mermaid
flowchart LR
  Hub["api.mcp-hub"]
  MCPRole["api:role.mcp-accessor-exchanger"]
  MCPAccessor["api:role.mcp-accessor"]
  DocsRole["api:role.docs-getter-exchanger"]
  DocsGetter["api:role.docs-getter"]

  Hub -->|member of| MCPRole
  MCPRole -->|zts.token_target_exchange| MCPAccessor
  Hub -->|temporary member of existing role| DocsRole
  DocsRole -->|zts.token_target_exchange| DocsGetter
```

```sh
./tools/athenz/create-role.sh api mcp-accessor-exchanger
./tools/athenz/add-policy.sh api mcp-accessor-exchanger zts.token_target_exchange api:role.mcp-accessor
./tools/athenz/add-role-member.sh api mcp-accessor-exchanger api.mcp-hub
```

```sh
#   ✔  Role created: api:role.mcp-accessor-exchanger
#   ✔  Policy created: api:policy.mcp-accessor-exchanger_zts_token_target_exchange_api_role_mcp-accessor
#   ✔  api.mcp-hub  →  api:role.mcp-accessor-exchanger
```

Add `api.mcp-hub` to the existing tutorial-owned `docs-getter-exchanger` role separately, because that membership is what lets the intermediate MCP token keep `docs-getter` for the final hop:

```sh
./tools/athenz/add-role-member.sh api docs-getter-exchanger api.mcp-hub
```

```sh
#   ✔  api.mcp-hub  →  api:role.docs-getter-exchanger
```

The final `mcp` to API hop uses the existing `docs-getter` role and the existing `api.api-mcp` exchange permissions from the base tutorial.

## Step 1. Fetch a delegated mcp-hub access token with the learner certificate

Use the core `human.idjag-learner` certificate to fetch the first access token directly. This is the X.509 version of the flow, so there is no Keycloak `id_token` and no ID_JAG token.

Request a delegation access token, not an impersonation-style token. When `actor=api.mcp-hub` is present, ZTS should mint the access token with a `may_act` claim for `api.mcp-hub`.

```sh
_hub_scope="api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor"
_hub_actor="api.mcp-hub"

_hub_at=$(./tools/athenz/fetch-access-token.sh \
  ./keys/idjag-learner.crt \
  ./keys/idjag-learner.key \
  "$_hub_scope" \
  --actor "$_hub_actor")
```

```sh
#   ·  Fetching Access Token for scope: api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor...
#   ✔  Access token issued for scope: api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor
# {
#   "typ": "at+jwt",
#   "alg": "RS256",
#   ...
# }
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "docs-getter",
#     "mcp-accessor",
#     "mcp-hub-accessor"
#   ],
#   "client_id": "human.idjag-learner",
#   "aud": "api",
#   "uid": "human.idjag-learner",
#   "may_act": {
#     "sub": "api.mcp-hub"
#   },
#   ...
# }
```

## Step 2. Fetch actor id_tokens for mcp-hub and mcp

Fetch actor `id_token` values for both service identities in the intended chain:

```sh
_mcp_hub_actor_id_token=$(./tools/athenz/fetch-actor-token.sh \
  ./keys/api-mcp-hub.crt \
  ./keys/api-mcp-hub.key \
  api.mcp-hub)

_mcp_actor_id_token=$(./tools/athenz/fetch-actor-token.sh \
  ./keys/api-mcp.crt \
  ./keys/api-mcp.key \
  api.api-mcp)
```

```sh
#   ·  Fetching actor id_token from Athenz ZTS for client: api.mcp-hub...
#   ✔  Actor id_token issued for client: api.mcp-hub
# {
#   "sub": "api.mcp-hub",
#   "aud": "api.mcp-hub",
#   "client_id": "api.mcp-hub",
#   ...
# }
#   ·  Fetching actor id_token from Athenz ZTS for client: api.api-mcp...
#   ✔  Actor id_token issued for client: api.api-mcp
# {
#   "sub": "api.api-mcp",
#   "aud": "api.api-mcp",
#   "client_id": "api.api-mcp",
#   ...
# }
```

## Step 3. Reproduce the wrong actor token failure

First, try the exchange with the wrong actor token. This intentionally fails because `_hub_at` says `may_act.sub` is `api.mcp-hub`, but this request presents the `api.api-mcp` actor token instead.

```sh
_mcp_scope="api:role.docs-getter api:role.mcp-accessor"

./tools/athenz/exchange-access-token.sh \
  ./keys/api-mcp-hub.crt \
  ./keys/api-mcp-hub.key \
  "$_hub_at" \
  "$_mcp_scope" \
  --actor-token "$_mcp_actor_id_token" \
  --actor api.api-mcp
```

```sh
#   ·  Exchanging access token for scope: api:role.docs-getter api:role.mcp-accessor...
# {
#   "code": 400,
#   "message": "Invalid subject token: may_act sub does not match actor token subject"
# }
```

## Step 4. Exchange from mcp-hub to mcp

Now perform the first delegated AT→AT exchange correctly: `api.mcp-hub` exchanges the hub token into the MCP carry-forward scopes for `api.api-mcp`.

`docs-getter` must stay in `_mcp_scope`; otherwise the final `api.api-mcp` to API exchange cannot request `docs-getter` because Athenz restricts the requested scope to what is present in the subject token.

The `--actor-token "$_mcp_hub_actor_id_token"` proves the current actor is `api.mcp-hub`, which must match the `may_act.sub` in `_hub_at`. The `--actor api.api-mcp` parameter names the next actor, so the exchanged token receives a new `may_act` claim for `api.api-mcp`.

Store the access token returned by this exchange as `_mcp_at`. This is the MCP-layer subject token for the final `api.api-mcp` to API exchange.

```sh
_mcp_at=$(./tools/athenz/exchange-access-token.sh \
  ./keys/api-mcp-hub.crt \
  ./keys/api-mcp-hub.key \
  "$_hub_at" \
  "$_mcp_scope" \
  --actor-token "$_mcp_hub_actor_id_token" \
  --actor api.api-mcp \
  --token-only)
```

```sh
#   ·  Exchanging access token for scope: api:role.docs-getter api:role.mcp-accessor...
#   ✔  Access token exchanged for scope: api:role.docs-getter api:role.mcp-accessor
# {
#   "typ": "at+jwt",
#   "alg": "RS256",
#   ...
# }
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "docs-getter",
#     "mcp-accessor"
#   ],
#   "client_id": "api.mcp-hub",
#   "aud": "api",
#   "uid": "api.mcp-hub",
#   "act": {
#     "sub": "api.mcp-hub"
#   },
#   "may_act": {
#     "sub": "api.api-mcp"
#   },
#   ...
# }
```

> [!NOTE]
> Delegated AT→AT exchange for access tokens is covered by Athenz PR #3390.

## Step 5. Exchange from mcp to API

The final hop is for `api.api-mcp` to exchange `_mcp_at` into the final API role `docs-getter`. This works because `_mcp_at` still contains `docs-getter`.

The resulting `act` chain should show `api.api-mcp` as the current actor, wrapping the previous `api.mcp-hub` actor. Unlike the ID_JAG version, there is no Claude service client in this chain because the original subject token came directly from the `human.idjag-learner` X.509 certificate.

```sh
_api_scope="api:role.docs-getter"

./tools/athenz/exchange-access-token.sh \
  ./keys/api-mcp.crt \
  ./keys/api-mcp.key \
  "$_mcp_at" \
  "$_api_scope" \
  --actor-token "$_mcp_actor_id_token" \
  --actor api
```

```sh
#   ·  Exchanging access token for scope: api:role.docs-getter...
#   ✔  Access token exchanged for scope: api:role.docs-getter
# {
#   "typ": "at+jwt",
#   "alg": "RS256",
#   ...
# }
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "docs-getter"
#   ],
#   "client_id": "api.api-mcp",
#   "aud": "api",
#   "uid": "api.api-mcp",
#   "act": {
#     "sub": "api.api-mcp",
#     "act": {
#       "sub": "api.mcp-hub"
#     }
#   },
#   "may_act": {
#     "sub": "api"
#   },
#   ...
# }
# {
#   "access_token": "...",
#   "token_type": "Bearer",
#   "expires_in": 3600,
#   "scope": "api:role.docs-getter",
#   ...
# }
```

## Clean-up 6. Delete temporary test resources

Clean up in dependency order: first remove the temporary `api.mcp-hub` memberships from tutorial-owned roles, then remove the provider-template assertion for `api.mcp-hub`, then delete the temporary `api.mcp-hub` service identity, and then delete the temporary policies and roles created only for this test.

The role deletes also remove their temporary members:

- `human.idjag-learner` from `api:role.mcp-hub-accessor`
- `api.mcp-hub` from `api:role.mcp-accessor-exchanger`

```sh
./tools/athenz/delete-role-member.sh api to-api-exchanger api.mcp-hub
./tools/athenz/delete-role-member.sh api docs-getter-exchanger api.mcp-hub
./tools/athenz/delete-assertion.sh api zts_instance_launch_provider grant launch zts_instance_launch_provider service.mcp-hub
./tools/athenz/delete-service.sh api mcp-hub
./tools/athenz/delete-policy.sh api mcp-accessor-exchanger_zts_token_target_exchange_api_role_mcp-accessor
./tools/athenz/delete-role.sh api mcp-accessor-exchanger
./tools/athenz/delete-role.sh api mcp-hub-accessor
```

```sh
#   ✔  Role member deleted or already absent: api.mcp-hub  →  api:role.to-api-exchanger
#   ✔  Role member deleted or already absent: api.mcp-hub  →  api:role.docs-getter-exchanger
#   ·  Deleting assertion from api:policy.zts_instance_launch_provider: grant launch to zts_instance_launch_provider on service.mcp-hub...
#   ✔  Assertion deleted or already absent: api:policy.zts_instance_launch_provider  grant launch to zts_instance_launch_provider on service.mcp-hub
#   ·  Deleting service api.mcp-hub...
#   ✔  Service deleted or already absent: api.mcp-hub
#   ✔  Policy deleted or already absent: api:policy.mcp-accessor-exchanger_zts_token_target_exchange_api_role_mcp-accessor
#   ✔  Role deleted or already absent: api:role.mcp-accessor-exchanger
#   ✔  Role deleted or already absent: api:role.mcp-hub-accessor
```

# Reference

- [Athenz PR #3390 — support subsequent delegated AT→AT exchange](https://github.com/AthenZ/athenz/pull/3390)
- [RFC 8693 — Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693)
