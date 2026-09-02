# Goal

Verify all nine ID-JAG-to-access-token scope combinations:

| ID-JAG input            | Single-scope AT | Same-domain multi-scope AT | Multi-domain AT |
|-------------------------|:---------------:|:--------------------------:|:---------------:|
| Single scope            |    ✅ Success    |        👍 Rejected         |   👍 Rejected   |
| Same-domain multi-scope |    ✅ Success    |         ✅ Success          |   👍 Rejected   |
| Multi-domain scope      |    ✅ Success    |         ✅ Success          |    ✅ Success    |

An access-token exchange may keep or remove scopes from the ID-JAG, but it must not add a scope.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Setup 1. Create the second-domain role and JAG exchange permission](#setup-1-create-the-second-domain-role-and-jag-exchange-permission)
- [Setup 2. Fetch the Keycloak ID token](#setup-2-fetch-the-keycloak-id-token)
- [Step 1. Test the single-scope ID-JAG](#step-1-test-the-single-scope-id-jag)
- [Step 2. Test the same-domain multi-scope ID-JAG](#step-2-test-the-same-domain-multi-scope-id-jag)
- [Step 3. Test the multi-domain ID-JAG](#step-3-test-the-multi-domain-id-jag)
- [Clean-up. Remove the test subdomain](#clean-up-remove-the-test-subdomain)

<!-- /TOC -->

<details>
<summary>Last verified on Sep 2, 2026 — ✅ Success</summary>

| # | Date        | Confirmed Working                                                                             |
|---|-------------|-----------------------------------------------------------------------------------------------|
| 1 | Sep 2, 2026 | ✅ All six allowed combinations succeeded; 👍 all three scope-expansion attempts were rejected |
| 2 | Sep 2, 2026 | 👍 Missing and invalid audiences were rejected; ✅ both scope-domain audiences succeeded       |

</details>

# Prerequisites

1. Complete [ID-JAG The Hard Way](../../../tutorials/16-id-jag.md).
1. Deploy the ZTS build containing multi-domain ID-JAG support.
1. Configure `athenz.zts.access_token_max_domains` to at least `2`.

# Steps

Run all commands from the ID-JAG The Hard Way repository root.
Raw access-token values are recorded as `<redacted>`; rerun the preceding command when the complete current token is required.

## Setup 1. Create the second-domain role and JAG exchange permission

The completed tutorial already provides the `api:role.docs-getter` and `api:role.mcp-accessor` roles, user memberships, and JAG exchange permissions.

Create the second domain and its target role:

```sh
./tools/athenz/create-subdomain.sh api multi-scoped
./tools/athenz/create-role.sh api.multi-scoped docs-getter
./tools/athenz/add-role-member.sh \
  api.multi-scoped docs-getter human.idjag-learner
```

```sh
#   ·  Creating Subdomain: api.multi-scoped...
#   ✔  Subdomain created: api.multi-scoped
#   ·  Creating Role: api.multi-scoped:role.docs-getter...
#   ✔  Role created: api.multi-scoped:role.docs-getter
#   ·  Adding Member human.idjag-learner to Role: api.multi-scoped:role.docs-getter...
#   ✔  human.idjag-learner  →  api.multi-scoped:role.docs-getter
```

Allow the Claude client to request that role in an ID-JAG:

```sh
./tools/athenz/create-role.sh \
  api.multi-scoped docs-getter-jag-exchanger
./tools/athenz/add-policy.sh \
  api.multi-scoped docs-getter-jag-exchanger \
  zts.jag_exchange role.docs-getter
./tools/athenz/add-role-member.sh \
  api.multi-scoped docs-getter-jag-exchanger \
  human.idjag-learner.claude
```

```sh
#   ·  Creating Role: api.multi-scoped:role.docs-getter-jag-exchanger...
#   ✔  Role created: api.multi-scoped:role.docs-getter-jag-exchanger
#   ·  Creating Policy: api.multi-scoped:policy.docs-getter-jag-exchanger_zts_jag_exchange_role_docs-getter...
#   ✔  Policy created: api.multi-scoped:policy.docs-getter-jag-exchanger_zts_jag_exchange_role_docs-getter
#   ·  Adding Member human.idjag-learner.claude to Role: api.multi-scoped:role.docs-getter-jag-exchanger...
#   ✔  human.idjag-learner.claude  →  api.multi-scoped:role.docs-getter-jag-exchanger
```

## Setup 2. Fetch the Keycloak ID token

```sh
./tools/keycloak/set-direct-access-grants.sh \
  human.idjag-learner.claude true

_client_secret=$(./tools/keycloak/get-client-secret.sh \
  human.idjag-learner.claude)

_id_token=$(./tools/keycloak/get-id-token.sh \
  human.idjag-learner.claude \
  "$_client_secret" \
  idjag-learner)
```

```sh
#   ·  Fetching Keycloak admin token...
#   ·  Looking up UUID for client human.idjag-learner.claude...
#   ·  Fetching client human.idjag-learner.claude...
#   ·  Setting Direct Access Grants for human.idjag-learner.claude: true...
#   ✔  Direct Access Grants set for human.idjag-learner.claude: true
#   ·  Fetching Keycloak admin token...
#   ·  Looking up UUID for client human.idjag-learner.claude...
#   ·  Fetching client secret for human.idjag-learner.claude...
#   ·  Fetching id_token from Keycloak for Keycloak username: idjag-learner, client: human.idjag-learner.claude...
#   ✔  id_token issued for Keycloak username: idjag-learner
# {
#   "alg": "RS256",
#   "typ": "JWT",
#   "kid": "jio8OS-7FzKy8UfOCol-zj1946k1y1JyC6Z6D676WKc"
# }
# {
#   "exp": 1788354031,
#   "iat": 1788339631,
#   "jti": "ae3fac73-c9cf-c4a9-7df8-bab5ac2f960c",
#   "iss": "http://localhost:34443/realms/master",
#   "aud": "human.idjag-learner.claude",
#   "sub": "3b1ebc43-f64d-446f-a388-b0431801fe57",
#   "typ": "ID",
#   "azp": "human.idjag-learner.claude",
#   "sid": "dBe_ixHQ-zgxsMF6EFIewPVR",
#   "at_hash": "XO2jLCN_MFFNcOrrWG8WCQ",
#   "acr": "1",
#   "email_verified": false,
#   "name": "ID-JAG Learner",
#   "preferred_username": "idjag-learner",
#   "given_name": "ID-JAG",
#   "family_name": "Learner",
#   "email": "idjag-learner@athenz.io"
# }
```

## Step 1. Test the single-scope ID-JAG

Issue the single-scope ID-JAG:

```sh
_single_id_jag=$(./tools/athenz/fetch-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_id_token" \
  "api:role.docs-getter")
```

```sh
#   ·  Exchanging id_token for ID_JAG (scope: api:role.docs-getter)...
#   ✔  ID_JAG issued (scope: api:role.docs-getter)
# {
#   "kid": "athenz-zts-server-56f8855d5b-bh2f4",
#   "typ": "oauth-id-jag+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "aud": "https://athenz-zts-server.athenz:4443/zts/v1",
#   "scp": [
#     "api:role.docs-getter"
#   ],
#   "ver": 1,
#   "auth_time": 1788339645,
#   "scope": "api:role.docs-getter",
#   "iss": "https://athenz-zts-server.athenz:4443/zts/v1",
#   "exp": 1788346845,
#   "iat": 1788339645,
#   "jti": "f79ea6ff-0286-4c50-ae4a-18b42a00934a",
#   "client_id": "human.idjag-learner.claude"
# }
```

Single scope to single scope succeeds:

```sh
./tools/athenz/fetch-access-token-with-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_single_id_jag" \
  "api:role.docs-getter"
```

```sh
#   ·  Fetching Access Token with ID_JAG for scope: api:role.docs-getter...
#   ✔  Access token issued with ID_JAG for scope: api:role.docs-getter
# {
#   "kid": "athenz-zts-server-56f8855d5b-bh2f4",
#   "typ": "at+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "docs-getter"
#   ],
#   "ver": 1,
#   "iss": "athenz-zts-server-56f8855d5b-bh2f4",
#   "client_id": "human.idjag-learner.claude",
#   "aud": "api",
#   "uid": "human.idjag-learner",
#   "auth_time": 1788339659,
#   "scope": "docs-getter",
#   "cnf": {
#     "x5t#S256": "fecN5s8tKZrCydEAPLRNKwLuq_q6vJQtt8JEuq6A9wY"
#   },
#   "exp": 1788361259,
#   "iat": 1788339659,
#   "jti": "a395c6f2-a35e-4c5c-a8d9-b495db0f6332"
# }
# <redacted>
```

Adding the second `api` role is rejected:

```sh
./tools/athenz/fetch-access-token-with-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_single_id_jag" \
  "api:role.docs-getter api:role.mcp-accessor"
```

```sh
#   ·  Fetching Access Token with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor...
#   ✘  Failed to issue an access token with ID_JAG. ZTS Response:
# {
#   "code": 400,
#   "message": "Invalid request: requested scope is not a subset of assertion scope"
# }
# ✘ Token issuance failed for scope: api:role.docs-getter api:role.mcp-accessor
```

Adding the second domain is rejected:

```sh
./tools/athenz/fetch-access-token-with-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_single_id_jag" \
  "api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter" \
  --audience api
```

```sh
#   ·  Fetching Access Token with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter...
#   ✘  Failed to issue an access token with ID_JAG. ZTS Response:
# {
#   "code": 400,
#   "message": "Invalid request: requested scope is not a subset of assertion scope"
# }
# ✘ Token issuance failed for scope: api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter
```

## Step 2. Test the same-domain multi-scope ID-JAG

Issue the same-domain multi-scope ID-JAG:

```sh
_same_domain_id_jag=$(./tools/athenz/fetch-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_id_token" \
  "api:role.docs-getter api:role.mcp-accessor")
```

```sh
#   ·  Exchanging id_token for ID_JAG (scope: api:role.docs-getter api:role.mcp-accessor)...
#   ✔  ID_JAG issued (scope: api:role.docs-getter api:role.mcp-accessor)
# {
#   "kid": "athenz-zts-server-56f8855d5b-bh2f4",
#   "typ": "oauth-id-jag+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "aud": "https://athenz-zts-server.athenz:4443/zts/v1",
#   "scp": [
#     "api:role.docs-getter",
#     "api:role.mcp-accessor"
#   ],
#   "ver": 1,
#   "auth_time": 1788339696,
#   "scope": "api:role.docs-getter api:role.mcp-accessor",
#   "iss": "https://athenz-zts-server.athenz:4443/zts/v1",
#   "exp": 1788346896,
#   "iat": 1788339696,
#   "jti": "db944ba0-e6a7-457c-90ad-6be4457af3a9",
#   "client_id": "human.idjag-learner.claude"
# }
```

Downscoping to one role succeeds:

```sh
./tools/athenz/fetch-access-token-with-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_same_domain_id_jag" \
  "api:role.docs-getter"
```

```sh
#   ·  Fetching Access Token with ID_JAG for scope: api:role.docs-getter...
#   ✔  Access token issued with ID_JAG for scope: api:role.docs-getter
# {
#   "kid": "athenz-zts-server-56f8855d5b-bh2f4",
#   "typ": "at+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "docs-getter"
#   ],
#   "ver": 1,
#   "iss": "athenz-zts-server-56f8855d5b-bh2f4",
#   "client_id": "human.idjag-learner.claude",
#   "aud": "api",
#   "uid": "human.idjag-learner",
#   "auth_time": 1788339704,
#   "scope": "docs-getter",
#   "cnf": {
#     "x5t#S256": "fecN5s8tKZrCydEAPLRNKwLuq_q6vJQtt8JEuq6A9wY"
#   },
#   "exp": 1788361304,
#   "iat": 1788339704,
#   "jti": "bbbf95e0-42c9-4ecb-9281-b020a4d010c7"
# }
# <redacted>
```

Keeping both same-domain roles also succeeds:

```sh
./tools/athenz/fetch-access-token-with-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_same_domain_id_jag" \
  "api:role.docs-getter api:role.mcp-accessor"
```

```sh
#   ·  Fetching Access Token with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor...
#   ✔  Access token issued with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor
# {
#   "kid": "athenz-zts-server-56f8855d5b-bh2f4",
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
#   "iss": "athenz-zts-server-56f8855d5b-bh2f4",
#   "client_id": "human.idjag-learner.claude",
#   "aud": "api",
#   "uid": "human.idjag-learner",
#   "auth_time": 1788339715,
#   "scope": "docs-getter mcp-accessor",
#   "cnf": {
#     "x5t#S256": "fecN5s8tKZrCydEAPLRNKwLuq_q6vJQtt8JEuq6A9wY"
#   },
#   "exp": 1788361315,
#   "iat": 1788339715,
#   "jti": "1b93fbf6-76b1-4a55-9e7c-55c24a2c2940"
# }
# <redacted>
```

Adding the second-domain role is rejected:

```sh
./tools/athenz/fetch-access-token-with-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_same_domain_id_jag" \
  "api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter" \
  --audience api
```

```sh
#   ·  Fetching Access Token with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter...
#   ✘  Failed to issue an access token with ID_JAG. ZTS Response:
# {
#   "code": 400,
#   "message": "Invalid request: requested scope is not a subset of assertion scope"
# }
# ✘ Token issuance failed for scope: api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter
```

## Step 3. Test the multi-domain ID-JAG

Issue the multi-domain ID-JAG:

```sh
_multi_domain_id_jag=$(./tools/athenz/fetch-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_id_token" \
  "api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter")
```

```sh
#   ·  Exchanging id_token for ID_JAG (scope: api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter)...
#   ✔  ID_JAG issued (scope: api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter)
# {
#   "kid": "athenz-zts-server-56f8855d5b-bh2f4",
#   "typ": "oauth-id-jag+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "aud": "https://athenz-zts-server.athenz:4443/zts/v1",
#   "scp": [
#     "api:role.docs-getter",
#     "api:role.mcp-accessor",
#     "api.multi-scoped:role.docs-getter"
#   ],
#   "ver": 1,
#   "auth_time": 1788339728,
#   "scope": "api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter",
#   "iss": "https://athenz-zts-server.athenz:4443/zts/v1",
#   "exp": 1788346928,
#   "iat": 1788339728,
#   "jti": "e91c3db6-8ef3-4898-b8f4-249f7866a9d9",
#   "client_id": "human.idjag-learner.claude"
# }
```

Downscoping to one role succeeds:

```sh
./tools/athenz/fetch-access-token-with-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_multi_domain_id_jag" \
  "api:role.docs-getter"
```

```sh
#   ·  Fetching Access Token with ID_JAG for scope: api:role.docs-getter...
#   ✔  Access token issued with ID_JAG for scope: api:role.docs-getter
# {
#   "kid": "athenz-zts-server-56f8855d5b-bh2f4",
#   "typ": "at+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "docs-getter"
#   ],
#   "ver": 1,
#   "iss": "athenz-zts-server-56f8855d5b-bh2f4",
#   "client_id": "human.idjag-learner.claude",
#   "aud": "api",
#   "uid": "human.idjag-learner",
#   "auth_time": 1788339751,
#   "scope": "docs-getter",
#   "cnf": {
#     "x5t#S256": "fecN5s8tKZrCydEAPLRNKwLuq_q6vJQtt8JEuq6A9wY"
#   },
#   "exp": 1788361351,
#   "iat": 1788339751,
#   "jti": "163f2794-0fc4-46f2-b236-8b07cd0aaad1"
# }
# <redacted>
```

Downscoping to both roles from the `api` domain succeeds:

```sh
./tools/athenz/fetch-access-token-with-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_multi_domain_id_jag" \
  "api:role.docs-getter api:role.mcp-accessor"
```

```sh
#   ·  Fetching Access Token with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor...
#   ✔  Access token issued with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor
# {
#   "kid": "athenz-zts-server-56f8855d5b-bh2f4",
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
#   "iss": "athenz-zts-server-56f8855d5b-bh2f4",
#   "client_id": "human.idjag-learner.claude",
#   "aud": "api",
#   "uid": "human.idjag-learner",
#   "auth_time": 1788339764,
#   "scope": "docs-getter mcp-accessor",
#   "cnf": {
#     "x5t#S256": "fecN5s8tKZrCydEAPLRNKwLuq_q6vJQtt8JEuq6A9wY"
#   },
#   "exp": 1788361364,
#   "iat": 1788339764,
#   "jti": "43f500bb-e85d-4dba-bb15-c953b0e30cbb"
# }
# <redacted>
```

Keeping all scopes succeeds when `api` is selected as the audience:

```sh
./tools/athenz/fetch-access-token-with-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_multi_domain_id_jag" \
  "api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter" \
  --audience api
```

```sh
#   ·  Fetching Access Token with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter...
#   ✔  Access token issued with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter
# {
#   "kid": "athenz-zts-server-56f8855d5b-bh2f4",
#   "typ": "at+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "docs-getter",
#     "mcp-accessor",
#     "api.multi-scoped:role.docs-getter"
#   ],
#   "ver": 1,
#   "iss": "athenz-zts-server-56f8855d5b-bh2f4",
#   "client_id": "human.idjag-learner.claude",
#   "aud": "api",
#   "uid": "human.idjag-learner",
#   "auth_time": 1788339775,
#   "scope": "docs-getter mcp-accessor api.multi-scoped:role.docs-getter",
#   "cnf": {
#     "x5t#S256": "fecN5s8tKZrCydEAPLRNKwLuq_q6vJQtt8JEuq6A9wY"
#   },
#   "exp": 1788361375,
#   "iat": 1788339775,
#   "jti": "d0035abc-98bd-44f3-8e52-7035b1e3bda8"
# }
# <redacted>
```

The audience-domain roles are short. The role from the other domain remains fully qualified so a later AT-to-AT exchange can select it.

Omitting the audience is rejected:

```sh
./tools/athenz/fetch-access-token-with-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_multi_domain_id_jag" \
  "api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter"
```

```sh
#   ·  Fetching Access Token with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter...
#   ✘  Failed to issue an access token with ID_JAG. ZTS Response:
# {
#   "code": 400,
#   "message": "Multiple scope domains require an audience"
# }
# ✘ Token issuance failed for scope: api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter
```

An audience outside the scope domains is rejected:

```sh
./tools/athenz/fetch-access-token-with-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_multi_domain_id_jag" \
  "api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter" \
  --audience storage
```

```sh
#   ·  Fetching Access Token with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter...
#   ✘  Failed to issue an access token with ID_JAG. ZTS Response:
# {
#   "code": 400,
#   "message": "Audience domain must be one of the scope domains"
# }
# ✘ Token issuance failed for scope: api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter
```

Selecting `api.multi-scoped` as the other valid audience succeeds:

```sh
./tools/athenz/fetch-access-token-with-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_multi_domain_id_jag" \
  "api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter" \
  --audience api.multi-scoped
```

```sh
#   ·  Fetching Access Token with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter...
#   ✔  Access token issued with ID_JAG for scope: api:role.docs-getter api:role.mcp-accessor api.multi-scoped:role.docs-getter
# {
#   "kid": "athenz-zts-server-56f8855d5b-bh2f4",
#   "typ": "at+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "api:role.docs-getter",
#     "api:role.mcp-accessor",
#     "docs-getter"
#   ],
#   "ver": 1,
#   "iss": "athenz-zts-server-56f8855d5b-bh2f4",
#   "client_id": "human.idjag-learner.claude",
#   "aud": "api.multi-scoped",
#   "uid": "human.idjag-learner",
#   "auth_time": 1788339834,
#   "scope": "api:role.docs-getter api:role.mcp-accessor docs-getter",
#   "cnf": {
#     "x5t#S256": "fecN5s8tKZrCydEAPLRNKwLuq_q6vJQtt8JEuq6A9wY"
#   },
#   "exp": 1788361434,
#   "iat": 1788339834,
#   "jti": "00e70693-4123-49ae-94a5-5e3db4381212"
# }
# <redacted>
```

## Clean-up. Remove the test subdomain

```sh
./tools/athenz/delete-domain.sh api.multi-scoped
```

```sh
#   ·  Deleting domain: api.multi-scoped...
#   ✔  Domain deleted (or did not exist): api.multi-scoped
```

# Reference

- [Previous unsupported multi-domain ID-JAG result](./260826-idjag-multiple-scope.md)
- [Multi-domain access-token behavior](../multi-domain-scoped/260826-x509-multiat-at.md)
- [OAuth 2.0 Token Exchange — RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html)
