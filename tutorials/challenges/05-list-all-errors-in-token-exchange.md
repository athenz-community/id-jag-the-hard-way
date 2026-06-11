|                                     Previous                                     |                   Current                    |                                Next                                |
|:--------------------------------------------------------------------------------:|:--------------------------------------------:|:------------------------------------------------------------------:|
| [Access Token with ID-JAG using curl](./04-access-token-with-id-jag-and-curl.md) | **List all errors in Access Token Exchange** | [New Keycloak Client with curl](./06-keycloak-client-with-curl.md) |

# Challenge: List all errors in Access Token Exchange

Coming soon.



## {"code":400,"message":"Invalid subject token: missing may_act claim"}

```sh
_exchange_scope="api:role.docs-getter"
_exchange_aud="api"

_delegated_at=$(curl -sS -X POST "$_zts_url" \
  --cert "./keys/api-mcp.crt" \
  --key "./keys/api-mcp.key" \
  --cacert "$_ca_cert" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "grant_type=urn:ietf:params:oauth:grant-type:token-exchange" \
  --data-urlencode "requested_token_type=urn:ietf:params:oauth:token-type:access_token" \
  --data-urlencode "subject_token_type=urn:ietf:params:oauth:token-type:access_token" \
  --data-urlencode "subject_token=$_at" \
  --data-urlencode "actor_token_type=urn:ietf:params:oauth:token-type:access_token" \
  --data-urlencode "actor_token=$_actor_at" \
  --data-urlencode "audience=$_exchange_aud" \
  --data-urlencode "scope=$_exchange_scope" | jq -r .access_token)

echo $_delegated_at | jq -R 'split(".") | .[1] | @base64d | fromjson'
```

# Next Challenge

[New Keycloak Client with curl](./06-keycloak-client-with-curl.md)
