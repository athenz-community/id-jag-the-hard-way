# Goal

The goal of this document is to verify whether one ID-JAG can carry multiple Athenz role scopes from the same or different domains, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Create a temporary second Athenz domain](#step-1-create-a-temporary-second-athenz-domain)
- [Step 2. Configure the second-domain target and JAG exchange roles](#step-2-configure-the-second-domain-target-and-jag-exchange-roles)
- [Step 3. Make the temporary domain available to ZTS](#step-3-make-the-temporary-domain-available-to-zts)
- [Step 4. Fetch the Keycloak ID token](#step-4-fetch-the-keycloak-id-token)
- [Step 5. Confirm a cross-domain ID-JAG is rejected](#step-5-confirm-a-cross-domain-id-jag-is-rejected)
- [Step 6. Issue one same-domain ID-JAG with multiple scopes](#step-6-issue-one-same-domain-id-jag-with-multiple-scopes)

<!-- /TOC -->

<details>
<summary>Last verified on Aug 26, 2026 — ✅ Success</summary>

| # | Date         | Confirmed Working                                                                                                                                                         |
|---|--------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1 | Aug 26, 2026 | ✅ Same-domain multi-scope ID-JAG was issued successfully; 👍 cross-domain ID-JAG failed as expected with `Multiple domains in scope` |

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete the main [ID-JAG The Hard Way tutorial](../../../tutorials/16-id-jag.md).

# Conclusion

- For Athenz v1.12.46 or earlier, multiple-domain-scoped ID-JAGs are not supported.
- Once the similar-concept PR [Feat: Access Token with Multiple Domain Supported for Full Token Exchange - #3407](https://github.com/AthenZ/athenz/pull/3407) is done, a follow-up PR for multiple-scope ID-JAGs will be created.

# Steps

Here is the procedure to get to the goals.

## Step 1. Create a temporary second Athenz domain

Use `api` as the first domain and create `api.idjag-multiple-scopes` as an isolated second domain:

```sh
./tools/athenz/create-subdomain.sh api idjag-multiple-scopes
```

```sh
#   ·  Creating Subdomain: api.idjag-multiple-scopes...
#   ✔  Subdomain created: api.idjag-multiple-scopes
```

The completed tutorial already provides the first-domain roles `api:role.docs-getter` and `api:role.mcp-accessor`, their user memberships, and the matching JAG exchange permissions for `human.idjag-learner.claude`.

## Step 2. Configure the second-domain target and JAG exchange roles

Create the second-domain target role and add the delegated human:

```sh
./tools/athenz/create-role.sh api.idjag-multiple-scopes docs-getter
./tools/athenz/add-role-member.sh \
  api.idjag-multiple-scopes \
  docs-getter \
  human.idjag-learner
```

```sh
#   ✔  Role created: api.idjag-multiple-scopes:role.docs-getter
#   ✔  human.idjag-learner  →  api.idjag-multiple-scopes:role.docs-getter
```

Create the corresponding JAG exchanger role, grant `zts.jag_exchange` on the target, and add the Claude service identity:

```sh
./tools/athenz/create-role.sh \
  api.idjag-multiple-scopes \
  docs-getter-jag-exchanger

./tools/athenz/add-policy.sh \
  api.idjag-multiple-scopes \
  docs-getter-jag-exchanger \
  zts.jag_exchange \
  role.docs-getter

./tools/athenz/add-role-member.sh \
  api.idjag-multiple-scopes \
  docs-getter-jag-exchanger \
  human.idjag-learner.claude
```

```sh
#   ✔  Role created: api.idjag-multiple-scopes:role.docs-getter-jag-exchanger
#   ✔  Policy created: api.idjag-multiple-scopes:policy.docs-getter-jag-exchanger_zts_jag_exchange_role_docs-getter
#   ✔  human.idjag-learner.claude  →  api.idjag-multiple-scopes:role.docs-getter-jag-exchanger
```

## Step 3. Make the temporary domain available to ZTS

The local ZTS data store must load the newly created domain before it can issue a token for it. Wait for the normal domain-data refresh, or restart only the local ZTS deployment for a deterministic test:

```sh
kubectl -n athenz rollout restart deployment/athenz-zts-server
kubectl -n athenz rollout status deployment/athenz-zts-server --timeout=180s
```

```sh
# deployment.apps/athenz-zts-server restarted
# deployment "athenz-zts-server" successfully rolled out
```

If the existing port-forward was interrupted by the rollout, wait for `tools/keep-k8s-port-forward.sh` to reconnect before continuing.

## Step 4. Fetch the Keycloak ID token

Enable Direct Access Grants for the tutorial client and fetch an ID token for `idjag-learner`:

```sh
./tools/keycloak/set-direct-access-grants.sh human.idjag-learner.claude true

_client_secret=$(./tools/keycloak/get-client-secret.sh human.idjag-learner.claude)
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
#   "exp": 1787722553,
#   "iat": 1787708153,
#   "jti": "3a474836-3dd5-0205-0a70-eca4d6c65fa4",
#   "iss": "http://localhost:34443/realms/master",
#   "aud": "human.idjag-learner.claude",
#   "sub": "3b1ebc43-f64d-446f-a388-b0431801fe57",
#   "typ": "ID",
#   "azp": "human.idjag-learner.claude",
#   "sid": "KigXDpIir25TF3986oRQDwx4",
#   "at_hash": "_xoKe2WLbraig3xvdxhUlw",
#   "acr": "1",
#   "email_verified": false,
#   "name": "ID-JAG Learner",
#   "preferred_username": "idjag-learner",
#   "given_name": "ID-JAG",
#   "family_name": "Learner",
#   "email": "idjag-learner@athenz.io"
# }
```

## Step 5. Confirm a cross-domain ID-JAG is rejected

First test the target case by requesting one role from `api` and one role from `api.idjag-multiple-scopes` in the same ID-JAG:

```sh
_cross_domain_scope="api:role.docs-getter api.idjag-multiple-scopes:role.docs-getter"

./tools/athenz/fetch-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_id_token" \
  "$_cross_domain_scope"
```

```sh
#   ·  Exchanging id_token for ID_JAG (scope: api:role.docs-getter api.idjag-multiple-scopes:role.docs-getter)...
#   ✘  Failed to fetch ID_JAG. ZTS response:
# {
#   "code": 400,
#   "message": "Multiple domains in scope"
# }
```

This failure happens during ID-JAG issuance. No cross-domain ID-JAG is issued.

## Step 6. Issue one same-domain ID-JAG with multiple scopes

Use two roles from the same `api` domain as the control case. This distinguishes the cross-domain restriction from a general restriction on multiple scopes:

```sh
_same_domain_scope="api:role.docs-getter api:role.mcp-accessor"

_same_domain_id_jag=$(./tools/athenz/fetch-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_id_token" \
  "$_same_domain_scope")
```

```sh
#   ·  Exchanging id_token for ID_JAG (scope: api:role.docs-getter api:role.mcp-accessor)...
#   ✔  ID_JAG issued (scope: api:role.docs-getter api:role.mcp-accessor)
# {
#   "typ": "oauth-id-jag+jwt",
#   ...
# }
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "api:role.docs-getter",
#     "api:role.mcp-accessor"
#   ],
#   "scope": "api:role.docs-getter api:role.mcp-accessor",
#   "client_id": "human.idjag-learner.claude",
#   ...
# }
```

# Clean up

Delete the isolated subdomain. This also removes the temporary roles and policy created inside it:

```sh
./tools/athenz/delete-domain.sh api.idjag-multiple-scopes
```

```sh
#   ·  Deleting domain: api.idjag-multiple-scopes...
#   ✔  Domain deleted (or did not exist): api.idjag-multiple-scopes
```

# Reference

- [OAuth 2.0 Token Exchange — RFC 8693, Section 2.1](https://www.rfc-editor.org/rfc/rfc8693.html#section-2.1)
- [Existing ID-JAG to access-token exchange research](../rfc8693_token_exchange/260613-idjag-del-del-exchange.md)
