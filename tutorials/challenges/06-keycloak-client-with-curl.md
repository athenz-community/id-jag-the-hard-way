|                                       Previous                                        |           Current            |                            Next                             |
|:-------------------------------------------------------------------------------------:|:----------------------------:|:-----------------------------------------------------------:|
| [List all errors in Access Token Exchange](./05-list-all-errors-in-token-exchange.md) | **New IdP Client with curl** | [Athenz Service ClientID](./07-athenz-service-client-id.md) |

# Challenge: New IdP Client with curl

In the tutorial, we have so far used the UI to register `ClientID`. Can we do this with curl?

- name `ai.open-webui-another-name`
- password: `password`
  - Client authencation: `On`
  - Direct access grants: `On`

<details>
<summary>Click to expand the solution</summary>
<br>

```sh
_new_client_id="ai.open-webui-another-name"
_new_client_secret="password"

_keycloak="http://localhost:34443"
_realm="master"

ADMIN_USER="admin"
ADMIN_PASSWORD="admin"

_admin_token="$(
  curl -sS -X POST "$_keycloak/realms/master/protocol/openid-connect/token" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    -d "client_id=admin-cli" \
    -d "username=$ADMIN_USER" \
    -d "password=$ADMIN_PASSWORD" \
    -d "grant_type=password" \
  | jq -r '.access_token'
)"

curl -sS -i -X POST "$_keycloak/admin/realms/$_realm/clients" \
  -H "Authorization: Bearer $_admin_token" \
  -H "Content-Type: application/json" \
  -d "{
    \"clientId\": \"$_new_client_id\",
    \"name\": \"$_new_client_id\",
    \"protocol\": \"openid-connect\",
    \"enabled\": true,

    \"publicClient\": false,
    \"clientAuthenticatorType\": \"client-secret\",
    \"secret\": \"$_new_client_secret\",

    \"standardFlowEnabled\": true,
    \"directAccessGrantsEnabled\": true,

    \"redirectUris\": [\"http://localhost/*\"],
    \"webOrigins\": [\"http://localhost\"]
  }"
```

**✅ We have successfully created a new client using curl**

```sh
# HTTP/1.1 201 Created
# Location: http://localhost:34443/admin/realms/master/clients/3a4f03d5-cf95-4193-9d5d-27d0c7379bb0
# Referrer-Policy: no-referrer
# Strict-Transport-Security: max-age=31536000; includeSubDomains
# X-Content-Type-Options: nosniff
# X-Frame-Options: SAMEORIGIN
# X-Robots-Tag: none
# content-length: 0
```

</details>

# Next Challenge

Next: [Athenz Service ClientID](./07-athenz-service-client-id.md)
