# Goal

The goal of this document is to reproduce an X.509 delegation→impersonation sequence and observe how the impersonation hop replaces the delegated bearer AT with a certificate-bound AT that has no actor chain, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Setup 1. Refresh the learner certificate](#setup-1-refresh-the-learner-certificate)
- [Setup 2. Create the mcp-hub access role](#setup-2-create-the-mcp-hub-access-role)
- [Setup 3. Create the mcp-hub service identity](#setup-3-create-the-mcp-hub-service-identity)
- [Setup 4. Allow mcp-hub to use api tokens as exchange input](#setup-4-allow-mcp-hub-to-use-api-tokens-as-exchange-input)
- [Setup 5. Allow mcp-hub to exchange into the requested scopes](#setup-5-allow-mcp-hub-to-exchange-into-the-requested-scopes)
- [Step 1. Issue the initial delegation-ready AT](#step-1-issue-the-initial-delegation-ready-at)
- [Step 2. Exchange the delegated AT by impersonation](#step-2-exchange-the-delegated-at-by-impersonation)
- [Clean-up 3. Delete temporary test resources](#clean-up-3-delete-temporary-test-resources)

<!-- /TOC -->

<details>
<summary>Verification status — 🟡 Pending human verification</summary>

| # | Date | Status |
|---|---|---|
| 1 | TBD | 🟡 Pending — procedure is derived from the current ZTS implementation but has not been manually run |

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

## Step 1. Issue the initial delegation-ready AT

Issue the first certificate-bound AT with `api.mcp-hub` in `may_act`:

```sh
_first_scope="api:role.docs-getter api:role.mcp-accessor api:role.mcp-hub-accessor"

_first_at=$(./tools/athenz/fetch-access-token.sh \
  ./keys/idjag-learner.crt \
  ./keys/idjag-learner.key \
  "$_first_scope" \
  --actor api.mcp-hub)
```

Expected initial claim shape:

| Claim | Value |
|---|---|
| `sub`, `client_id`, and `uid` | `human.idjag-learner` |
| `may_act.sub` | `api.mcp-hub` |
| `act` | Absent |
| `cnf.x5t#S256` | Thumbprint of `idjag-learner.crt` |

## Step 2. Exchange the delegated AT by impersonation

Use the `api.mcp-hub` certificate but omit `actor_token`:

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
| `cnf.x5t#S256` | Rebound to the `api.mcp-hub` certificate |

The input token is bound to the learner certificate. The current Token Exchange implementation validates it as a subject token without enforcing that input `cnf` against the `api.mcp-hub` certificate. The newly issued impersonation AT receives its own binding.

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
- [RFC 8705 — OAuth 2.0 Mutual-TLS Client Authentication and Certificate-Bound Access Tokens](https://datatracker.ietf.org/doc/html/rfc8705)
- [Athenz `processAccessTokenImpersonationRequest`](../../../athenz_dist/athenz/servers/zts/src/main/java/com/yahoo/athenz/zts/ZTSImpl.java)
