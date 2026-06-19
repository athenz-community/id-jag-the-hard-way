|                   Previous                   |                Current                 |                                       Next                                       |
|:--------------------------------------------:|:--------------------------------------:|:--------------------------------------------------------------------------------:|
| [ID-JAG with Curl](./02-id-jag-with-curl.md) | **List all errors in ID_JAG Exchange** | [Access Token with ID-JAG using curl](./04-access-token-with-id-jag-and-curl.md) |

# Challenge: Get all errors in ID_JAG exchange

Assume that you have the `id_token` fetched with the following command:

```sh
_id_token=$(curl -s -X POST "http://localhost:34443/realms/master/protocol/openid-connect/token" \
  -d "client_id=ai.open-webui" \
  -d "client_secret=QHmUf9IpJftBZi5M8fBptubwlhW2DTWf" \
  -d "username=idjag-learner" \
  -d "password=password" \
  -d "scope=openid email profile" \
  -d "grant_type=password" | jq -r '.id_token')

echo $_id_token | jq -R 'split(".") | .[1] | @base64d | fromjson'
```

```sh
# {
#   "iss": "http://localhost:34443/realms/master",
#   "aud": "ai.open-webui",
#   "sub": "aaa9c26b-9609-47b1-a298-2ded44f28f21",
#   "typ": "ID",
#   "preferred_username": "idjag-learner",
#   ...
# }
```

Can you get errors below from authrozation server (Athenz) while exchaging the `id_token` into `ID_JAG`?

<!-- TOC depthFrom:2 depthTo:2 -->

- [{"code":400,"message":"Invalid subject token: Unable to parse token: Expired JWT"}](#code400messageinvalid-subject-token-unable-to-parse-token-expired-jwt)
- [{"code":400,"message":"Invalid subject token audience"}](#code400messageinvalid-subject-token-audience)
- [{"code":400,"message":"Invalid subject token: Unable to parse token: Invalid JWT serialization: Missing dot delimiter(s)"}](#code400messageinvalid-subject-token-unable-to-parse-token-invalid-jwt-serialization-missing-dot-delimiters)
- [{"code":400,"message":"Invalid subject token: Unable to parse token: Invalid unsecured/JWS/JWE header: Invalid JSON object"}](#code400messageinvalid-subject-token-unable-to-parse-token-invalid-unsecuredjwsjwe-header-invalid-json-object)
- [{"code":400,"message":"Invalid request: no subject token provided"}](#code400messageinvalid-request-no-subject-token-provided)

<!-- /TOC -->



## {"code":400,"message":"Invalid subject token: Unable to parse token: Expired JWT"}

<details>
<summary>Click to expand the solution</summary>
<br>

Wait for a minute and do:

```sh
local _cert_path="./ai_client_gateway/certs/open-webui.crt"
local _key_path="./ai_client_gateway/certs/open-webui.key"
local _ca_cert="./athenz_dist/certs/ca.cert.pem"
local _zts_url="https://localhost:8443/zts/v1/oauth2/token"
local _role_scope="api:role.mcp-accessor api:role.docs-getter"
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
  --data-urlencode "audience=$_id_jag_aud"
```

```sh
# {"code":400,"message":"Invalid subject token: Unable to parse token: Expired JWT"}
```

**👍 We have successfully output the `{"code":400,"message":"Invalid subject token: Unable to parse token: Expired JWT"}` by using expired id_token (JWT)**

</details>


## {"code":400,"message":"Invalid subject token audience"}

> [!TIP]
> [Related Athenz Source Code](https://github.com/AthenZ/athenz/blob/fed5efe72c772874ab654205589a1d7947b2e8ad/servers/zts/src/main/java/com/yahoo/athenz/zts/ZTSImpl.java#L3139-L3149)

<details>
<summary>Click to expand the solution</summary>
<br>

Assume that you have finished the tutorial and have all keys:

```sh
ls -al keys
```

```sh
total 48
# drwxr-xr-x   8 mlajkim  staff   256 May 18 06:49 .
# drwxr-xr-x  21 mlajkim  staff   672 Jun  1 06:01 ..
# -rw-r--r--   1 mlajkim  staff  1271 May 18 06:57 api_docs-getter.jwt
# -rw-r--r--   1 mlajkim  staff  1308 May 18 06:49 api_mcp-accessor_api_docs-getter.jwt
# -rw-r--r--   1 mlajkim  staff  1740 May 17 16:19 idjag-learner.crt
# -rw-r--r--   1 mlajkim  staff  1271 May 18 06:14 idjag-learner.jwt
# -rw-------   1 mlajkim  staff  1675 May 17 16:17 idjag-learner.key
# -rw-r--r--   1 mlajkim  staff   451 May 17 16:17 idjag-learner.public.key
```

Quickly openssl to see the CN `human.idjag-learner`:

```sh
local _cert_path="./keys/idjag-learner.crt"
local _key_path="./keys/idjag-learner.key"

openssl x509 -in $_cert_path -noout -subject
```

```sh
# subject=C=US, O=Oath Inc., OU=Athenz, CN=human.idjag-learnerCN=idjag-learner
```

Use the X.509 Certificate under `keys` that does NOT represent the client_id `ai.open-webui`:

```sh
local _ca_cert="./athenz_dist/certs/ca.cert.pem"
local _zts_url="https://localhost:8443/zts/v1/oauth2/token"
local _role_scope="api:role.mcp-accessor api:role.docs-getter"
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
  --data-urlencode "audience=$_id_jag_aud"
```

```sh
# {"code":400,"message":"Invalid subject token audience"
```

**👍 We have successfully output the `{"code":400,"message":"Invalid subject token audience"}` by using the wrong X.509 Certificate.**

Quickly check the `CN` that correctly represents `ai.open-webui`:

```sh
local _cert_path="./ai_client_gateway/certs/open-webui.crt"
local _key_path="./ai_client_gateway/certs/open-webui.key"

openssl x509 -in $_cert_path -noout -subject
```

```sh
# subject=C=US, O=Oath Inc., OU=Athenz, CN=ai.open-webui
```

Make sure that I get ID_JAG no problem with modified `_cert_path` and `_key_path`:

```sh
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
  --data-urlencode "audience=$_id_jag_aud"
```

```sh
# {"access_token":"eyJraWQiOiJhdGhlb ...","token_type":"N_A","expires_in":7200,"scope":"api:role.docs-getter api:role.mcp-accessor","issued_token_type":"urn:ietf:params:oauth:token-type:id-jag"}
```

**✅ We have confirmed that fixing the `_cert_path` and `_key_path` only will fix the error.**

</details>

## {"code":400,"message":"Invalid subject token: Unable to parse token: Invalid JWT serialization: Missing dot delimiter(s)"}

<details>
<summary>Click to expand the solution</summary>
<br>

```sh
local _id_token="malformed"

local _cert_path="./ai_client_gateway/certs/open-webui.crt"
local _key_path="./ai_client_gateway/certs/open-webui.key"
local _ca_cert="./athenz_dist/certs/ca.cert.pem"
local _zts_url="https://localhost:8443/zts/v1/oauth2/token"
local _role_scope="api:role.mcp-accessor api:role.docs-getter"
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
  --data-urlencode "audience=$_id_jag_aud"
```

**👍 We have successfully output the `{"code":400,"message":"Invalid subject token: Unable to parse token: Invalid JWT serialization: Missing dot delimiter(s)"}` by using non-empty string `malformed` as `_id_token`.**

</details>

## {"code":400,"message":"Invalid subject token: Unable to parse token: Invalid unsecured/JWS/JWE header: Invalid JSON object"}

<details>
<summary>Click to expand the solution</summary>
<br>

```sh
local _id_token="malformed.malformed"

local _cert_path="./ai_client_gateway/certs/open-webui.crt"
local _key_path="./ai_client_gateway/certs/open-webui.key"
local _ca_cert="./athenz_dist/certs/ca.cert.pem"
local _zts_url="https://localhost:8443/zts/v1/oauth2/token"
local _role_scope="api:role.mcp-accessor api:role.docs-getter"
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
  --data-urlencode "audience=$_id_jag_aud"
```

**👍 We have successfully output the `{"code":400,"message":"Invalid subject token: Unable to parse token: Invalid unsecured/JWS/JWE header: Invalid JSON object"}` by including dot and use non-JSON string `malformed` as `_id_token`.**

</details>

## {"code":400,"message":"Invalid request: no subject token provided"}

<details>
<summary>Click to expand the solution</summary>
<br>

```sh
local _id_token=""

local _cert_path="./ai_client_gateway/certs/open-webui.crt"
local _key_path="./ai_client_gateway/certs/open-webui.key"
local _ca_cert="./athenz_dist/certs/ca.cert.pem"
local _zts_url="https://localhost:8443/zts/v1/oauth2/token"
local _role_scope="api:role.mcp-accessor api:role.docs-getter"
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
  --data-urlencode "audience=$_id_jag_aud"
```

**👍 We have successfully output the `{"code":400,"message":"Invalid subject token audience"}` by using the wrong X.509 Certificate.**

</details>



# Next Challenge

[Access Token with ID-JAG using curl](./04-access-token-with-id-jag-and-curl.md) 
