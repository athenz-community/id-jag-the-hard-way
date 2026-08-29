# Goal

The goal of this document is to reproduce an ID-JAG impersonation→impersonation sequence and observe how the subject is preserved without creating an actor chain, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Setup 1. Create the mcp-hub roles](#setup-1-create-the-mcp-hub-roles)
- [Setup 2. Create the mcp-hub service identity](#setup-2-create-the-mcp-hub-service-identity)
- [Setup 3. Allow mcp-hub to use api tokens as exchange input](#setup-3-allow-mcp-hub-to-use-api-tokens-as-exchange-input)
- [Setup 4. Allow mcp-hub to exchange into the requested scopes](#setup-4-allow-mcp-hub-to-exchange-into-the-requested-scopes)
- [Setup 5. Fetch an id_token](#setup-5-fetch-an-id_token)
- [Step 1. Exchange the id_token for ID_JAG](#step-1-exchange-the-id_token-for-id_jag)
- [Step 2. Issue the initial impersonation AT](#step-2-issue-the-initial-impersonation-at)
- [Step 3. Exchange the AT by impersonation again](#step-3-exchange-the-at-by-impersonation-again)
- [Clean-up 4. Delete temporary test resources](#clean-up-4-delete-temporary-test-resources)

<!-- /TOC -->

<details>
<summary>Verification status — 🟡 Pending human verification</summary>

| # | Date | Status |
|---|---|---|
| 1 | TBD | 🟡 Pending — procedure is derived from the current ZTS implementation but has not been manually run |

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

## Setup 5. Fetch an id_token

```sh
./tools/keycloak/set-direct-access-grants.sh human.idjag-learner.claude true
_client_secret=$(./tools/keycloak/get-client-secret.sh human.idjag-learner.claude)
_id_token=$(./tools/keycloak/get-id-token.sh human.idjag-learner.claude "$_client_secret" idjag-learner)
```

## Step 1. Exchange the id_token for ID_JAG

```sh
_id_jag_scope="api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor"

_id_jag=$(./tools/athenz/fetch-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_id_token" \
  "$_id_jag_scope")
```

## Step 2. Issue the initial impersonation AT

Omit `actor` from the ID-JAG→AT request:

```sh
_first_scope="api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor"

_first_at=$(./tools/athenz/fetch-access-token-with-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_id_jag" \
  "$_first_scope")
```

Expected initial claim shape:

| Claim | Value |
|---|---|
| `sub` | `human.idjag-learner` |
| `client_id` | `human.idjag-learner.claude` |
| `act` | Absent |
| `may_act` | Absent |
| `cnf` | Absent |

## Step 3. Exchange the AT by impersonation again

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

Expected claim transformation:

| Claim | Expected result |
|---|---|
| `sub` | Remains `human.idjag-learner` |
| `client_id` and `uid` | Become `api.mcp-hub` |
| `act` | Absent |
| `may_act` | Absent |
| `cnf.x5t#S256` | Added for the `api.mcp-hub` certificate |

## Clean-up 4. Delete temporary test resources

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
