# Goal

The goal of this document is to configure an Athenz service alias `clientId` so that an `id_token` issued for a different Keycloak client ID is accepted during the `ID_JAG` exchange, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Create the alternate Keycloak client](#step-1-create-the-alternate-keycloak-client)
- [Step 2. Fetch id_token with the alternate client](#step-2-fetch-id_token-with-the-alternate-client)
- [Step 3. Fetch the Claude X.509 certificate](#step-3-fetch-the-claude-x509-certificate)
- [Step 4. Reproduce the ID_JAG audience error](#step-4-reproduce-the-id_jag-audience-error)
- [Step 5. Inspect the existing service metadata](#step-5-inspect-the-existing-service-metadata)
- [Step 6. Set the clientId alias on the Athenz service](#step-6-set-the-clientid-alias-on-the-athenz-service)
- [Step 7. Verify the alias is applied](#step-7-verify-the-alias-is-applied)
- [Step 8. Confirm ID_JAG exchange works with the new client](#step-8-confirm-id_jag-exchange-works-with-the-new-client)
- [Clean-up 9. Clean up temporary clientId test state](#clean-up-9-clean-up-temporary-clientid-test-state)

<!-- /TOC -->

<details>
<summary>Last verified on Jul 10, 2026 — ✅ Success</summary>

| # | Date         | Confirmed Working                                                                                                          |
|---|--------------|----------------------------------------------------------------------------------------------------------------------------|
| 1 | Jun 20, 2026 | ✅ — setup completed successfully as expected; 👍 audience mismatch failed as expected; ✅ cleanup restored default metadata |
| 2 | Jul 10, 2026 | ✅ — setup completed successfully as expected; 👍 audience mismatch failed as expected; ✅ cleanup restored default metadata |

</details>

# Prerequisites

This tutorial requires the following to be completed:

- [16-id-jag.md](../../../tutorials/16-id-jag.md)

# Steps

Here is the procedure to get to the goals. Steps 1-8 complete the setup goal; Clean-up 9 restores the temporary test state.

## Step 1. Create the alternate Keycloak client

Create or update an alternate Keycloak client named `human.idjag-learner.claude-another-name`. This client deliberately uses a different client ID from the canonical Keycloak client ID `human.idjag-learner.claude`, which is mapped to the Athenz service identity `human.idjag-learner.claude`.

```sh
_acg_port=$(./tools/port.sh ai-client-gateway)

KEYCLOAK_CLIENT_SECRET=password \
KEYCLOAK_DIRECT_ACCESS_GRANTS=true \
KEYCLOAK_OPEN_UI=true \
  ./tools/keycloak/create-client.sh \
  human.idjag-learner.claude-another-name \
  "http://localhost:${_acg_port}/oauth/callback" \
  "http://localhost:${_acg_port}"
```

```sh
  # ·  Fetching Keycloak admin token...
  # ·  Looking up client human.idjag-learner.claude-another-name in realm master...
  # ·  Creating client human.idjag-learner.claude-another-name...
  # ✔  Client created: human.idjag-learner.claude-another-name
  # ✔  Opened: http://localhost:34443/admin/master/console/#/master/clients/998e1558-b883-45a0-8d52-69467268c9c8/settings
```

## Step 2. Fetch id_token with the alternate client

Fetch an `id_token` for the Keycloak username `idjag-learner` using `human.idjag-learner.claude-another-name`:

```sh
_id_token=$(./tools/keycloak/get-id-token.sh human.idjag-learner.claude-another-name password idjag-learner)
```

```sh
#   ·  Fetching id_token from Keycloak for Keycloak username: idjag-learner, client: human.idjag-learner.claude-another-name...
#   ✔  id_token issued for Keycloak username: idjag-learner
# {
#   "alg": "RS256",
#   "typ": "JWT",
#   "kid": "jio8OS-7FzKy8UfOCol-zj1946k1y1JyC6Z6D676WKc"
# }
# {
#   "exp": 1783682114,
#   "iat": 1783667714,
#   "jti": "c90eea43-4e2a-9ced-fae0-fd2731e2fc23",
#   "iss": "http://localhost:34443/realms/master",
#   "aud": "human.idjag-learner.claude-another-name",
#   "sub": "3b1ebc43-f64d-446f-a388-b0431801fe57",
#   "typ": "ID",
#   "azp": "human.idjag-learner.claude-another-name",
#   "sid": "qRBug3ee0DnyvB629foL4xiB",
#   "at_hash": "TGR6Yq5ZJt_51kQBzF0MsA",
#   "acr": "1",
#   "email_verified": false,
#   "name": "ID-JAG Learner",
#   "preferred_username": "idjag-learner",
#   "given_name": "ID-JAG",
#   "family_name": "Learner",
#   "email": "idjag-learner@athenz.io"
# }
```

The Keycloak token identifies the user as `idjag-learner` in `preferred_username`; it does not contain the Athenz `human.` prefix. Athenz maps that username to `human.idjag-learner` later during ID-JAG exchange. The `aud` / `azp` values are the Keycloak client ID used to request the token.

## Step 3. Fetch the Claude X.509 certificate

Fetch the certificate for the Athenz Claude service identity:

```sh
./tools/athenz/fetch-cert.sh "human.idjag-learner" "claude" "./keys/human-idjag-learner-claude.key" "v1"
```

```sh
  # ·  Fetching X.509 Certificate for human.idjag-learner.claude...
  # ✔  Certificate saved to: ./keys/human-idjag-learner-claude.crt
```

## Step 4. Reproduce the ID_JAG audience error

Attempt the ID_JAG exchange using the `human-idjag-learner-claude.crt` certificate (CN=`human.idjag-learner.claude`). The audiences do not match, so ZTS rejects the token:

```sh
_role_scope="api:role.mcp-accessor"

./tools/athenz/exchange-id-token-for-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_id_token" \
  "$_role_scope" | jq .
```

```sh
# {
#   "code": 400,
#   "message": "Invalid subject token audience"
# }
```

> [!TIP]
> This failure is expected. The ZTS log shows an expected-audience `human.idjag-learner.claude-another-name` mismatch for the certificate principal `human.idjag-learner.claude`.

## Step 5. Inspect the existing service metadata

Confirm the current `human.idjag-learner.claude` service metadata before applying the alternate client ID. The canonical baseline uses `clientId: human.idjag-learner.claude`.

```sh
./tools/athenz/show-service.sh human.idjag-learner claude
```

```sh
#   ·  Showing service human.idjag-learner.claude...
# {
#   "name": "human.idjag-learner.claude",
#   "publicKeys": [
#     {
#       "key": "LS0tLS1CRUdJTiBQVU...<omitted for brevity>...CTElDIEtFWS0tLS0tCg--",
#       "id": "v1"
#     }
#   ],
#   "modified": "2026-07-10T07:13:54.285Z"
# }
```

## Step 6. Set the clientId alias on the Athenz service

```sh
./tools/athenz/set-service-client-id.sh human.idjag-learner claude human.idjag-learner.claude-another-name
```

```sh
  # ·  Setting clientId for human.idjag-learner.claude: human.idjag-learner.claude-another-name...
  # ✔  clientId set for human.idjag-learner.claude: human.idjag-learner.claude-another-name
```

> [!NOTE]
> This requires `authorize ("update", "sys.auth:meta.service.{attribute}.{domain}")`. Using `athenz_admin.cert.pem` bypasses the permission check for local testing.

## Step 7. Verify the alias is applied

```sh
./tools/athenz/show-service.sh human.idjag-learner claude
```

```sh
#   ·  Showing service human.idjag-learner.claude...
# {
#   "name": "human.idjag-learner.claude",
#   "modified": "2026-07-10T07:20:54.285Z",
#   "publicKeys": [
#     {
#       "id": "v1",
#       "key": "LS0tLS1CRUdJTiBQVUJMSUMgS0VZ..."
#     }
#   ],
#   "clientId": "human.idjag-learner.claude-another-name"
# }
```

## Step 8. Confirm ID_JAG exchange works with the new client

Re-run the exchange from Step 4. It should now succeed:

```sh
./tools/athenz/exchange-id-token-for-id-jag.sh \
  ./keys/human-idjag-learner-claude.crt \
  ./keys/human-idjag-learner-claude.key \
  "$_id_token" \
  "$_role_scope" | jq .
```

```sh
# {"access_token":"eyJ...","token_type":"N_A","expires_in":7200,...}
```

## Clean-up 9. Clean up temporary clientId test state

Restore the service metadata to the default by clearing the explicit `clientId` override. With the override empty, later research files use the Athenz service name `human.idjag-learner.claude` as the Keycloak client ID source of truth again:

```sh
./tools/athenz/set-service-client-id.sh human.idjag-learner claude ""
./tools/athenz/show-service.sh human.idjag-learner claude
```

```sh
#   ·  Setting clientId for human.idjag-learner.claude: ...
#   ✔  clientId set for human.idjag-learner.claude:
#   ·  Showing service human.idjag-learner.claude...
# {
#   "name": "human.idjag-learner.claude",
#   "publicKeys": [
#     {
#       "key": "LS0tLS1CRUdJTiBQVU...<omitted for brevity>...CTElDIEtFWS0tLS0tCg--",
#       "id": "v1"
#     }
#   ],
#   "modified": "2026-07-10T07:36:21.593Z",
#   "clientId": ""
# }
```

Delete the temporary Keycloak client created for this experiment:

```sh
./tools/keycloak/delete-client.sh human.idjag-learner.claude-another-name
```

```sh
#   ·  Fetching Keycloak admin token...
#   ·  Looking up UUID for client human.idjag-learner.claude-another-name...
#   ·  Deleting client human.idjag-learner.claude-another-name...
#   ✔  Client deleted: human.idjag-learner.claude-another-name
```

# Reference

- [Athenz ServiceIdentity RDL — clientId field](https://github.com/AthenZ/athenz/blob/master/core/zms/src/main/rdl/ServiceIdentity.tdl#L61)
- [Athenz ServiceIdentity RDLi — clientId API](https://github.com/AthenZ/athenz/blob/master/core/zms/src/main/rdl/ServiceIdentity.rdli#L148-L164)
