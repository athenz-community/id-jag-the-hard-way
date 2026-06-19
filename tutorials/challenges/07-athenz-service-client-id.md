|                              Previous                              |             Current              | Next |
|:------------------------------------------------------------------:|:--------------------------------:|:----:|
| [New Keycloak Client with curl](./06-keycloak-client-with-curl.md) | **Keycloak Client ID with curl** | n/a  |

# Challenge: ID_JAG with client_id

We just created a new client  `ai.open-webui-another-name`. 

Now, try to get `ID_JAG` using this new client, BUT keep using the certificate `open-webui.crt`.

```sh
_get_id_jag_for_open_webui_another_name() {
  _secret=$1

  _id_token=$(curl -s -X POST "http://localhost:34443/realms/master/protocol/openid-connect/token" \
    -d "client_id=ai.open-webui-another-name" \
    -d "client_secret=$_secret" \
    -d "username=idjag-learner" \
    -d "password=password" \
    -d "scope=openid email profile" \
    -d "grant_type=password" | jq -r '.id_token')

  echo $_id_token | jq -R 'split(".") | .[1] | @base64d | fromjson'

  local _cert_path="./ai_client_gateway/certs/open-webui.crt"
  local _key_path="./ai_client_gateway/certs/open-webui.key"
  local _ca_cert="./athenz_dist/certs/ca.cert.pem"
  local _zts_url="https://localhost:8443/zts/v1/oauth2/token"
  local _role_scope="api:role.mcp-accessor"
  local _id_jag_aud="https://athenz-zts-server.athenz:4443/zts/v1"

  curl -sS -X POST "$_zts_url" \
    --cert "$_cert_path" \
    --key "$_key_path" \
    --cacert "$_ca_cert" \
    -H "Content-Type: application/x-www-form-urlencoded" \
    --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
    --data-urlencode "requested_token_type=urn:ietf:params:oauth:token-type:id-jag" \
    --data-urlencode "subject_token_type=urn:ietf:params:oauth:token-type:id_token" \
    --data-urlencode "subject_token=$_id_token" \
    --data-urlencode "scope=$_role_scope" \
    --data-urlencode "audience=$_id_jag_aud" | jq .
}
```

You will get the following error:

```sh
_client_secret="hWUdyeKAtX3hmhyG8nOB72jdTfB8pfyu"
_get_id_jag_for_open_webui_another_name $_client_secret
```

```sh
# {
#   "code": 400,
#   "message": "Invalid subject token audience"
# }
```

> [!TIP]
> Athenz offers to have a customized Oauth2 `client_id` for a specific service name ([Code](https://github.com/AthenZ/athenz/blob/master/core/zms/src/main/rdl/ServiceIdentity.tdl#L61))

Can you fix this using only Athenz settings? (No code changes)

<details>
<summary>Click to expand the solution</summary>
<br>

The ZTS Server will output this kind of error:

```sh
# ERROR com.yahoo.athenz.zts.ZTSImpl - The subject token does not have expected audience: human.idjag-learner/ai.client-gateway
```

Get the service account metadata:

```sh
_domain="ai"
_service="open-webui"
local _ca_cert="./athenz_dist/certs/ca.cert.pem"
local _cert="./athenz_dist/certs/athenz_admin.cert.pem"
local _key="./athenz_dist/keys/athenz_admin.private.pem"

curl -s -k -X GET "https://localhost:4443/zms/v1/domain/${_domain}/service/${_service}" \
  --cert "$_cert" \
  --key "$_key" \
  -H "Content-Type: application/json" | jq .
```

```sh
# {
#   "name": "ai.open-webui",
#   "publicKeys": [
#     {
#       "key": "....Redacted...",
#       "id": "v1"
#     }
#   ],
#   "modified": "2026-05-17T07:19:14.418Z"
# }
```

## Set Alias

> [!NOTE]
> You need `authorize ("update", "sys.auth:meta.service.{attribute}.{domain}")`, but if you use `athenz_admin.cert.pem`, you can bypass permission setting

Run the following command:

```sh
_zms_url="https://localhost:4443/zms/v1"

_domain="ai"
_service="open-webui"
_alias_client_id="ai.open-webui-another-name"

_admin_cert="./athenz_dist/certs/athenz_admin.cert.pem"
_admin_key="./athenz_dist/keys/athenz_admin.private.pem"
_ca_cert="./athenz_dist/certs/ca.cert.pem"

curl -si "%{http_code}\n" -X PUT "$_zms_url/domain/$_domain/service/$_service/meta/system/clientId" \
  --cert "$_admin_cert" \
  --key "$_admin_key" \
  --cacert "$_ca_cert" \
  -H "Content-Type: application/json" \
  -H "Y-Audit-Ref: set-client-id-for-id-jag" \
  -d "{\"clientId\":\"$_alias_client_id\"}"
```

```sh
# HTTP/1.1 204 No Content
# Host: athenz-zms-server-568d4cfd89-9z2bz
```

Then check once again with `clientId`:

```sh
_domain="ai"
_service="open-webui"
local _ca_cert="./athenz_dist/certs/ca.cert.pem"
local _cert="./athenz_dist/certs/athenz_admin.cert.pem"
local _key="./athenz_dist/keys/athenz_admin.private.pem"

curl -s -k -X GET "https://localhost:4443/zms/v1/domain/${_domain}/service/${_service}" \
  --cert "$_cert" \
  --key "$_key" \
  -H "Content-Type: application/json" | jq .
```

New field `"clientId": "ai.open-webui-another-name"`

```sh
# {
#   "name": "ai.open-webui",
#   "publicKeys": [
#     {
#       "key": "...Redacted...",
#       "id": "v1"
#     }
#   ],
#   "modified": "2026-06-09T02:39:49.001Z",
#   "clientId": "ai.open-webui-another-name"
# }
```

> [!NOTE]
> [Source Code](https://github.com/AthenZ/athenz/blob/master/core/zms/src/main/rdl/ServiceIdentity.rdli#L148-L164)


Then try to get the `ID_JAG` once again:

```sh
_client_secret="hWUdyeKAtX3hmhyG8nOB72jdTfB8pfyu"
_get_id_jag_for_open_webui_another_name $_client_secret
```

**✅ We have confirmed that we can set an alias for Athenz Service.**

</details>

# Next Challenge

Coming soon ...
