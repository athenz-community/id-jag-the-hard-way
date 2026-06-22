|                      Previous                       |         Current         |                       Next                       |
|:---------------------------------------------------:|:-----------------------:|:------------------------------------------------:|
| [Authorization Server](./07-athenz-access-token.md) | **Granular Permission** | [MCP Server for API](./09-mcp-server-for-api.md) |

# Granular Permission

In the previous tutorial, you used the admin certificate — which has unrestricted power — to mint an Access Token. This tutorial replaces that with a dedicated identity representing you, scoped to exactly the permissions you need.

<details>
<summary>Why does dedicated identity matter?</summary>
<br>

### Why a separate identity instead of admin?

Admin credentials can do anything in Athenz: create domains, register services, modify policies. Using them for routine API calls is like handing someone a master key every time they need to open one specific door. If those credentials are ever leaked or misused, the blast radius is unlimited.

Instead, you create a dedicated identity — `human.idjag-learner` — that exists solely to call the API as you, the learner. In Athenz, access control is always evaluated against a **principal**: a named entity that can be placed into roles and granted policies. By giving yourself a distinct principal, you can apply fine-grained policies to it without touching anything admin-level.

> [!NOTE]
> Athenz has a feature called **UserCert**, which represents an actual human being rather than a service account. For simplicity, this tutorial skips that feature and uses a service identity to represent you instead.

### Why generate a private key?

In Athenz, **identity is cryptographic — holding the private key is what makes you that identity.** There is no username or password. The public key is registered with Athenz under your service name. When you authenticate to ZTS (the token server), you present a certificate signed with your private key. ZTS verifies the signature against the registered public key and, if they match, issues you an Access Token as `human.idjag-learner`.

If you hold the key, you are that principal. If you don't, you cannot claim to be.

### Why does scoping the token matter?

The token you fetch is not a general-purpose credential — it is scoped to a specific role (`api:role.docs-getter`). Even if the token is leaked, an attacker can only call the endpoints that role permits and nothing else. The private key stays on your machine; the short-lived, narrowly scoped token is what travels over the network. This is the foundation of **least-privilege access**.

</details>

<!-- TOC depthFrom:2 depthTo:2 -->

- [Create Service Identity that represents you](#create-service-identity-that-represents-you)
- [Create TLD for your future Service Identity](#create-tld-for-your-future-service-identity)
- [Create Service Identity](#create-service-identity)
- [Fetch X.509 Cert for idjag-learner](#fetch-x509-cert-for-idjag-learner)
- [Fetch the Service Certificate](#fetch-the-service-certificate)
- [Fetch Access Token (JWT)](#fetch-access-token-jwt)
- [Troubleshoot Missing Role Membership](#troubleshoot-missing-role-membership)
- [Review Architecture](#review-architecture)

<!-- /TOC -->

## Create Service Identity that represents you

Generate a private key that represents `idjag-learner`:

```sh
./tools/athenz/create-private-key.sh "./keys/idjag-learner"
```

```sh
# Generating RSA key pair for: ./keys/idjag-learner...
# Done! Keys generated: ./keys/idjag-learner.key, ./keys/idjag-learner.public.key
```

## Create TLD for your future Service Identity

In Athenz, every service identity—even those representing human users—must reside within a domain. To keep things organized, let's create a new Top-Level Domain (TLD) named `human`.

Run the following command to create the TLD:

```sh
./tools/athenz/create-tld.sh "human"
```

This creates the `human` domain, represented by the purple section in the following diagram:

![08_create_tld_human](./assets/08_create_tld_human.png)

## Create Service Identity

Execute the script to register your identity `human.idjag-learner`:

```sh
./tools/athenz/create-service.sh "human" "idjag-learner" "./keys/idjag-learner.public.key"
```

This successfully creates the `idjag-learner` service under the `human` domain. You can verify the result in the Athenz UI:

```sh
_athenz_ui_port=$(./tools/port.sh athenz-ui)
./tools/open.sh "http://localhost:${_athenz_ui_port}/domain/human/service"
```

![08_new_service](./assets/08_new_service.png)

## Fetch X.509 Cert for idjag-learner

Execute the script to authorize the `idjag-learner` service to fetch certificates:

```sh
./tools/athenz/enable-cert-provider.sh "human" "idjag-learner"
```

```sh
# Enabling ZTS Certificate Provider for human.idjag-learner...
# [Template(s) successfully applied to domain]
```

## Fetch the Service Certificate

Execute the script using the parameters we configured earlier:

```sh
./tools/athenz/fetch-cert.sh "human" "idjag-learner" "./keys/idjag-learner.key" "v1"
```

```sh
# Fetching X.509 Certificate for human.idjag-learner...
# Done! Certificate saved to: ./keys/idjag-learner.crt
```

## Fetch Access Token (JWT)

Now that you possess your Mutual TLS (mTLS) credentials (`idjag-learner.crt` and `idjag-learner.key`), you can use them to authenticate against the ZTS server and request an Athenz Access Token (JWT).

To enforce the principle of least privilege, we will specifically request a token scoped only to the `docs-getter` role within the `api` domain (`api:role.docs-getter`):

> [!WARNING]
> This command will fail — that is intentional and you will fix it in the next section.

```sh
_scope="api:role.docs-getter"
_my_access_token=$(./tools/athenz/fetch-access-token.sh \
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
_athenz_ui_port=$(./tools/port.sh athenz-ui)
./tools/open.sh "http://localhost:${_athenz_ui_port}/domain/api/role/docs-getter/members"
```

![08_id_jag_learner_not_in_role_yet](./assets/08_id_jag_learner_not_in_role_yet.png)

To fix this, simply run the member addition script we created earlier:

```sh
./tools/athenz/add-role-member.sh "api" "docs-getter" "human.idjag-learner"
```

Open once again your Athenz UI to verify that `human.idjag-learner` has been successfully added to the role:

```sh
_athenz_ui_port=$(./tools/port.sh athenz-ui)
./tools/open.sh "http://localhost:${_athenz_ui_port}/domain/api/role/docs-getter/members"
```

![08_human_id_jag_learner_now_added_as_member](./assets/08_human_id_jag_learner_now_added_as_member.png)

Now that your service identity is a recognized member of the role, fetch the access token again:

```sh
_scope="api:role.docs-getter"
_my_access_token=$(./tools/athenz/fetch-access-token.sh \
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

You successfully fetched an X.509 certificate for the non-admin service identity (`human.idjag-learner`) — instead of the admin certificate — and exchanged it for an Athenz Access Token scoped specifically to `api:role.docs-getter`:

![08_arc_fetch_at_with_non_admin_certificiate](./assets/08_arc_fetch_at_with_non_admin_certificiate.png)

Next: [MCP Server for API](./09-mcp-server-for-api.md)
