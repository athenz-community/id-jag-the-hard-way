|                                Previous                                 |                 Current                 |                                         Next                                          |
|:-----------------------------------------------------------------------:|:---------------------------------------:|:-------------------------------------------------------------------------------------:|
| [List all errors in ID_JAG exchange](./03-list-all-errors-in-id-jag.md) | **Access Token with ID-JAG using curl** | [List all errors in Access Token Exchange](./05-list-all-errors-in-token-exchange.md) |

# Challenge: Obtaining an Access Token via cURL
This section covers hands-on challenges related to acquiring Access Tokens (RFC 7521) and performing Token Exchanges (RFC 8693):

<!-- TOC depthFrom:2 depthTo:2 -->

- [Challenge: Get Access Token with ID_JAG](#challenge-get-access-token-with-id_jag)
- [Challenge: Impersonation Token Exchange](#challenge-impersonation-token-exchange)
- [Challenge: Delegation Token Exchange](#challenge-delegation-token-exchange)

<!-- /TOC -->

# Prerequistes

You can retrieve the `ID_JAG` token using the following command:

```sh
_id_token=$(curl -s -X POST "http://localhost:34443/realms/master/protocol/openid-connect/token" \
  -d "client_id=ai.open-webui" \
  -d "client_secret=QHmUf9IpJftBZi5M8fBptubwlhW2DTWf" \
  -d "username=idjag-learner" \
  -d "password=password" \
  -d "scope=openid email profile" \
  -d "grant_type=password" | jq -r '.id_token')

local _cert_path="./ai_client_gateway/certs/open-webui.crt"
local _key_path="./ai_client_gateway/certs/open-webui.key"
local _ca_cert="./athenz_dist/certs/ca.cert.pem"
local _zts_url="https://localhost:8443/zts/v1/oauth2/token"
local _role_scope="api:role.mcp-accessor api:role.docs-getter"
local _id_jag_aud="https://athenz-zts-server.athenz:4443/zts/v1"

_id_jag=$(curl -sS -X POST "$_zts_url" \
  --cert "$_cert_path" \
  --key "$_key_path" \
  --cacert "$_ca_cert" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  --data-urlencode "requested_token_type=urn:ietf:params:oauth:token-type:id-jag" \
  --data-urlencode "subject_token_type=urn:ietf:params:oauth:token-type:id_token" \
  --data-urlencode "subject_token=$_id_token" \
  --data-urlencode "scope=$_role_scope" \
  --data-urlencode "audience=$_id_jag_aud" | jq -r .access_token)

echo $_id_jag | jq -R 'split(".") | .[0] | @base64d | fromjson'
echo $_id_jag | jq -R 'split(".") | .[1] | @base64d | fromjson'
```

## Challenge: Get Access Token with ID_JAG

Fetch the Access Token with the scope `_role_scope="api:role.docs-getter api:role.mcp-accessor"`, using the following certificates:

```sh
# --cert "./ai_client_gateway/certs/open-webui.crt"
# --key "./ai_client_gateway/certs/open-webui.key"
```

<details>
<summary>Click to expand the solution</summary>
<br>

```sh
_role_scope="api:role.docs-getter api:role.mcp-accessor"

_at=$(curl -sS -X POST "$_zts_url" \
  --cert "./ai_client_gateway/certs/open-webui.crt" \
  --key "./ai_client_gateway/certs/open-webui.key" \
  --cacert "$_ca_cert" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer" \
  --data-urlencode "assertion=$_id_jag" \
  --data-urlencode "scope=$_role_scope" \
  --data-urlencode "expires_in=3600" | jq -r .access_token)

echo $_at | jq -R 'split(".") | .[0] | @base64d | fromjson'
echo $_at | jq -R 'split(".") | .[1] | @base64d | fromjson'
```

```sh
# {
#   "kid": "athenz-zts-server-b485bd456-lxjkl",
#   "typ": "at+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "aud": "api",
#   "scp": [
#     "docs-getter",
#     "mcp-accessor"
#   ],
#   "uid": "human.idjag-learner",
#   "ver": 1,
#   "auth_time": 1781131563,
#   "scope": "docs-getter mcp-accessor",
#   "iss": "https://athenz-zts-server.athenz:4443/zts/v1",
#   "exp": 1781138712,
#   "iat": 1781131563,
#   "jti": "f944800f-cdf6-42fd-84e1-0c570e7fb46f",
#   "client_id": "ai.open-webui"
# }
```

**✅ Successfully retrieved the Access Token using ID-JAG.**

</details>

## Challenge: Impersonation Token Exchange

Perform a token exchange with narrowed scope: `_exchange_scope="api:role.docs-getter"`, acting as an MCP server:

```sh
# --cert "./keys/api-mcp.crt"
# --key "./keys/api-mcp.key"
```

<details>
<summary>Click to expand the solution</summary>
<br>

```sh
_exchange_scope="api:role.docs-getter"
_exchange_aud="api"

_exchanged_at=$(curl -sS -X POST "$_zts_url" \
  --cert "./keys/api-mcp.crt" \
  --key "./keys/api-mcp.key" \
  --cacert "$_ca_cert" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  --data-urlencode "requested_token_type=urn:ietf:params:oauth:token-type:access_token" \
  --data-urlencode "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  --data-urlencode "subject_token=$_at" \
  --data-urlencode "audience=$_exchange_aud" \
  --data-urlencode "scope=$_exchange_scope" | jq -r .access_token)

echo $_exchanged_at | jq -R 'split(".") | .[1] | @base64d | fromjson'
```

```sh
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "docs-getter"
#   ],
#   "ver": 1,
#   "iss": "athenz-zts-server-b485bd456-lxjkl",
#   "client_id": "api.api-mcp",
#   "aud": "api",
#   "uid": "api.api-mcp",
#   "auth_time": 1781132034,
#   "scope": "docs-getter",
#   "cnf": {
#     "x5t#S256": "e4PIzPg2AO2yk_FqWczzGvt2p3fVvYdMm0oW8GsiBiY"
#   },
#   "exp": 1781139234,
#   "iat": 1781132034,
#   "jti": "a850a156-5787-4c47-b443-a13236d8c6f0"
# }
```

**✅ Successfully exchanged and scoped down the Access Token via impersonation.**

</details>

## Challenge: Delegation Token Exchange

> [!NOTE]
> Currently, the Athenz server does not support delegation token exchange. We will update this section once the feature becomes available!
> Working PRs:
> - https://github.com/AthenZ/athenz/pull/3388

# Next Challenge

[List all errors in Access Token Exchange](./05-list-all-errors-in-token-exchange.md)
