|                      Previous                       |         Current         |                       Next                       |
|:---------------------------------------------------:|:-----------------------:|:------------------------------------------------:|
| [Authorization Server](./05-athenz-access-token.md) | **Granular Permission** | [MCP Server for API](./07-mcp-server-for-api.md) |

# Granular Permission

In this tutorial, you will implement granular permissions by establishing a dedicated service identity to access the protected API server.

## Create Service Identity that represents you

Generate a private key that represents `idjag-learner`:

```sh
./my_tools/create-private-key.sh "./keys/idjag-learner"
```

```sh
# Generating RSA key pair for: ./keys/idjag-learner...
# Done! Keys generated: ./keys/idjag-learner.key, ./keys/idjag-learner.public.key
```

## Create TLD for your future Service Identity

In Athenz, every service identity—even those representing human users—must reside within a domain. To keep things organized, let's create a new Top-Level Domain (TLD) named `human`.

Run the following command to create the TLD:

```sh
./my_tools/create-tld.sh "human"
```

This creates the `human` domain, represented by the purple section in the following diagram:

![06_create_tld_human](./assets/06_create_tld_human.png)

## Create Service Identity

Execute the script to register your identity `human.idjag-learner`:

```sh
./my_tools/create-service.sh "human" "idjag-learner" "./keys/idjag-learner.public.key"
```

This successfully creates the `idjag-learner` service under the `human` domain. You can verify the result in the Athenz UI:

```sh
_athenz_ui_port=3000
open "http://localhost:${_athenz_ui_port}/domain/human/service"
```

![06_new_service](./assets/06_new_service.png)

## Fetch X.509 Cert for idjag-learner

Execute the script to authorize the `idjag-learner` service to fetch certificates:

```sh
./my_tools/enable-cert-provider.sh "human" "idjag-learner"
```

```sh
# Enabling ZTS Certificate Provider for human.idjag-learner...
# [Template(s) successfully applied to domain]
```

## Fetch the Service Certificate

Execute the script using the parameters we configured earlier:

```sh
./my_tools/fetch-cert.sh "human" "idjag-learner" "./keys/idjag-learner.key" "v1"
```

```sh
# Fetching X.509 Certificate for human.idjag-learner...
# Done! Certificate saved to: ./keys/idjag-learner.crt
```

## Fetch Access Token (JWT)

Now that you possess your Mutual TLS (mTLS) credentials (`idjag-learner.crt` and `idjag-learner.key`), you can use them to authenticate against the ZTS server and request an Athenz Access Token (JWT).

To enforce the principle of least privilege, we will specifically request a token scoped only to the `docs-getter` role within the `api` domain (`api:role.docs-getter`):

```sh
_scope="api:role.docs-getter"
_my_access_token=$(./my_tools/fetch-access-token.sh \
  "./keys/idjag-learner.crt" \
  "./keys/idjag-learner.key" \
  "${_scope}" \
  "./keys/idjag-learner.jwt")
```

```sh
# 🔥 [ERROR] Failed to issue an access token. ZTS Response:
# {
#   "code": 403,
#   "message": "postaccesstokenrequest: principal human.idjag-learner is not included in the requested role(s) in domain api"
# }
```

## Troubleshoot Missing Role Membership

Why did this request fail? Because the `human.idjag-learner` service identity is not explicitly authorized to assume the `api:role.docs-getter` role. Athenz defaults to deny. You can confirm this by checking the role members in the UI:

```sh
_athenz_ui_port=3000
open "http://localhost:${_athenz_ui_port}/domain/api/role/docs-getter/members"
```

![06_id_jag_learner_not_in_role_yet](./assets/06_id_jag_learner_not_in_role_yet.png)

To fix this, simply run the member addition script we created earlier:

```sh
./my_tools/add-role-member.sh "api" "docs-getter" "human.idjag-learner"
```

Open once again your Athenz UI to verify that `human.idjag-learner` has been successfully added to the role:

```sh
_athenz_ui_port=3000
open "http://localhost:${_athenz_ui_port}/domain/api/role/docs-getter/members"
```

![06_human_id_jag_learner_now_added_as_member](./assets/06_human_id_jag_learner_now_added_as_member.png)

Now that your service identity is a recognized member of the role, fetch the access token again:

```sh
_scope="api:role.docs-getter"
_my_access_token=$(./my_tools/fetch-access-token.sh \
  "./keys/idjag-learner.crt" \
  "./keys/idjag-learner.key" \
  "${_scope}" \
  "./keys/idjag-learner.jwt")
```

```sh
# ✅ [SUCCESS] Issued the following access token:
# {
#   "kid": "athenz-zts-server-6966ff7f66-4j67d",
#   "typ": "at+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "docs-getter"
#   ],
#   "ver": 1,
#   "iss": "athenz-zts-server-6966ff7f66-4j67d",
#   "client_id": "human.idjag-learner",
#   "aud": "api",
#   "uid": "human.idjag-learner",
#   "auth_time": 1778451929,
#   "scope": "docs-getter",
#   "cnf": {
#     "x5t#S256": "QUXJN5ALSWRR_fK5iHMwo0hnmlp01mcnyiNcd141o1E"
#   },
#   "exp": 1778455529,
#   "iat": 1778451929,
#   "jti": "cca1a64e-f309-47bd-94b9-3cef584663ef"
# }
```

Finally, send a request to the protected API server with the newly minted access token attached to the Authorization header:

```sh
curl -s -k -H "Authorization: Bearer $_my_access_token" http://localhost:14443/api/docs | jq .
```

```sh
# {
#   "docs": [
#     {
#       "name": "first default doc",
#       "id": 1,
#       "content": "hello world"
#     },
#     {
#       "name": "second default doc",
#       "id": 2,
#       "content": "how are you?"
#     }
#   ]
# }
```

## Review Architecture

You successfully fetched an X.509 certificate for the non-admin service identity (`human.idjag-learner`) and exchanged it for an Athenz Access Token scoped specifically to `api:role.docs-getter`:

![06_arc_fetch_at_with_non_admin_certificiate](./assets/06_arc_fetch_at_with_non_admin_certificiate.png)

Next: [MCP Server for API](./07-mcp-server-for-api.md)
