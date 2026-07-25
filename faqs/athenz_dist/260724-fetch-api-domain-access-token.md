# Goal

Fetch an Athenz access token containing every `api` role accessible to the requesting principal. Because the request contains only one scope domain, ZTS derives `aud=api` without an explicit audience parameter.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Fetch the access token](#step-1-fetch-the-access-token)

<!-- /TOC -->

<details>
<summary>Last verified on 2026-07-25 — ✅ Success</summary>

| # | Date       | Status                                  |
|---|------------|-----------------------------------------|
| 1 | 2026-07-25 | ✅ Success — human confirmed fully tested |

</details>

# Prerequisites

- Run the commands from the ID-JAG The Hard Way repository root.
- The local ZTS environment is running.
- The `human.idjag-learner` certificate and private key exist under `keys/`.
- The principal has access to at least one role in the `api` domain.

# Steps

## Step 1. Fetch the access token

Request `api:domain`:

```sh
_api_domain_at=$(./tools/athenz/fetch-access-token.sh \
  ./keys/idjag-learner.crt \
  ./keys/idjag-learner.key \
  "api:domain")
```

```sh
#   ·  Fetching Access Token for scope: api:domain...
#   ✔  Access token issued for scope: api:domain
# {
#   "kid": "athenz-zts-server-6c79cbd6cc-lxqmt",
#   "typ": "at+jwt",
#   "alg": "RS256"
# }
# {
#   "sub": "human.idjag-learner",
#   "scp": [
#     "docs-getter",
#     "docs-deleter",
#     "mcp-accessor",
#     "mcp-hub-accessor"
#   ],
#   "ver": 1,
#   "iss": "athenz-zts-server-6c79cbd6cc-lxqmt",
#   "client_id": "human.idjag-learner",
#   "aud": "api",
#   "uid": "human.idjag-learner",
#   "auth_time": 1784955788,
#   "scope": "docs-getter docs-deleter mcp-accessor mcp-hub-accessor",
#   "cnf": {
#     "x5t#S256": "M9CEWNkaiOZXe9XZ1zxgWqJPElQ2cWT_NOgZcsMWM7I"
#   },
#   "exp": 1784959388,
#   "iat": 1784955788,
#   "jti": "f69b696a-ffd4-4330-878f-09d90d651d3f"
# }
```

`api:domain` means “return every role in the `api` domain that this principal can access.” It does not grant roles that the principal cannot access. An explicit audience is unnecessary because `api` is the only domain in the requested scope.

# FAQs

**Does `api:domain` grant every role defined in `api`?**

No. It returns every `api` role that the requesting principal can access.

**Why does the token contain `reader` instead of `api:role.reader`?**

Roles belonging to the audience domain use simple names in the token. With `aud=api`, `reader` represents `api:role.reader`.

**When is an explicit audience required?**

An explicit audience is required when the request contains scopes from more than one domain. For the single-domain `api:domain` request, ZTS derives the audience from `api`.

# Reference

- [Athenz access-token guide](../../athenz_dist/athenz/docs/zts_access_token_guide.md)
- [fetch-access-token.sh](../../tools/athenz/fetch-access-token.sh)
