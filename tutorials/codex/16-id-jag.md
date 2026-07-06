|                    Previous                    |      Current      |                      Next                      |
|:----------------------------------------------:|:-----------------:|:----------------------------------------------:|
| [AI Client Gateway](./15-ai-client-gateway.md) | **ID-JAG — Codex** | *None: You are at the end of the tutorial! 🎉* |

# ID-JAG — Codex

In this tutorial, we will resolve the authorization failure from the previous step. We will configure the token exchange policies in Athenz that allow the AI Client Gateway to exchange your Keycloak ID token for an ID-JAG token on your behalf. Once those permissions are in place, you will run the same prompt again and see it succeed end-to-end.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Grant Permissions to `human.idjag-learner.codex`](#grant-permissions-to-humanidjag-learnercodex)
- [Verify](#verify)
- [What's happened?](#whats-happened)
- [Finally](#finally)

<!-- /TOC -->

## Grant Permissions to `human.idjag-learner.codex`

The `human.idjag-learner.codex` service needs permission to perform JAG exchange into the target roles it will use.

Create one role for each exchange target:

```sh
./tools/athenz/create-role.sh "api" "docs-getter-jag-exchanger"
./tools/athenz/create-role.sh "api" "mcp-accessor-jag-exchanger"
```

Grant the `zts.jag_exchange` action for `api:role.docs-getter` and `api:role.mcp-accessor`:

```sh
./tools/athenz/add-policy.sh "api" "docs-getter-jag-exchanger" "zts.jag_exchange" "role.docs-getter"
./tools/athenz/add-policy.sh "api" "mcp-accessor-jag-exchanger" "zts.jag_exchange" "role.mcp-accessor"
```

Now add `human.idjag-learner.codex` as a member of both roles:

```sh
./tools/athenz/add-role-member.sh "api" "docs-getter-jag-exchanger" "human.idjag-learner.codex"
./tools/athenz/add-role-member.sh "api" "mcp-accessor-jag-exchanger" "human.idjag-learner.codex"
```

```sh
#   ·  Adding Member human.idjag-learner.codex to Role: api:role.docs-getter-jag-exchanger...
#   ✔  human.idjag-learner.codex  →  api:role.docs-getter-jag-exchanger
#   ·  Adding Member human.idjag-learner.codex to Role: api:role.mcp-accessor-jag-exchanger...
#   ✔  human.idjag-learner.codex  →  api:role.mcp-accessor-jag-exchanger
```

## Verify

Restart Codex to reconnect with the new permissions:

```sh
codex
```

> [!NOTE]
> 🟡 TODO: Verify the exact reconnect flow for Codex CLI — whether it requires a re-authentication step or picks up the session automatically.

Then send the same prompt that failed in the previous tutorial:

```
get docs from k8s doc server!
```

> [!NOTE]
> 🟡 TODO: Add a screenshot of Codex successfully retrieving docs end-to-end via the ID-JAG flow.

You got the docs. Hooray.

## What's happened?

The logs show each authorization boundary in the chain.

1. The AI Client Gateway resolved the signed-in user's Keycloak ID token, exchanged it for an ID-JAG token, and then fetched an Athenz Access Token.

```sh
kubectl logs -n human deployment/codex-idjag-learner-ai-client-gateway --tail=30
```

```sh
# [Athenz ID-JAG] 🔑 Resolved ID token from bearer session (Claude Code path)
# [Athenz ID-JAG] 🔄 Attempting to exchange new ID-JAG with id-token for scope [api:role.docs-getter api:role.mcp-accessor] ...
# [Athenz ID-JAG] 🎯 Target ZTS for ID-JAG: https://athenz-zts-server.athenz:4443/zts/v1/oauth2/token
# [Athenz ID-JAG] 🎫 Granted scope in ID-JAG: ["api:role.docs-getter","api:role.mcp-accessor"]
# [Athenz AT] Fetching Athenz Access Token using ID-JAG ...
# [Athenz AT] 🎯 Target ZTS for AT: https://athenz-zts-server.athenz:4443/zts/v1/oauth2/token
# [Athenz AT] 🔑 Successfully fetched Athenz Access Token. Granted scope: ["docs-getter","mcp-accessor"]
```

2. The MCP Authorization Proxy checked that the gateway's Access Token had `access` on `mcp`.

```sh
kubectl logs -n api deployment/mcp -c auth-proxy --tail=20
```

```sh
# [2026-07-06 21:30:34] [INFO] [MCP-Auth-Proxy] ✅ AUTHORIZED: 'access' on 'mcp' (Token: eyJraWQiOi...)
# [2026-07-06 21:30:34] [INFO] [MCP-Auth-Proxy] ➡️ Forwarding to downstream MCP Server for API Server
```

3. The MCP server exchanged the incoming Access Token for an API-specific `docs-getter` Access Token.

```sh
kubectl logs -n api deployment/mcp -c mcp --tail=20
```

```sh
# [INFO] [Token Exchange] Initiating for scope: "api:role.docs-getter" using /app/certs/api-mcp.crt cert, token: eyJraWQiOiJhdGhl...
# [INFO] [Token Exchange] ✅ Success! scope: ["api:role.docs-getter"] gotScope: ["docs-getter"] token: eyJraWQiOiJhdGhl...
# 2026-07-07T06:30:34+09:00 [INFO] IP: 127.0.0.1 | POST /mcp HTTP/1.1 | Status: 200 | Time: 268.199 ms
# Headers: -
# Body: {
#   method: 'tools/call',
#   params: {
#     name: 'get_k8s_docs',
#     arguments: {}
#   },
#   jsonrpc: '2.0',
#   id: 2
# }
```

4. The API server authorized the final token and returned the docs.

```sh
kubectl logs -n api deployment/api-server --tail=20
```

```sh
# [DEBUG] Access Granted: Action 'get' allowed on Resource 'docs' (Token: eyJraWQi...)
```

At every hop, the Principle of Least Privilege was enforced — each component only held the minimum permissions it needed.

## Finally

Thank you for following along. Hope it was helpful.

You have seen the full ID-JAG flow end-to-end: a human signs in, an AI agent acts on their behalf with a scoped identity, enterprise policy governs exactly what the agent can do, and the organization can tighten or expand those boundaries at any time — without touching application code.

If you found this tutorial useful, please consider giving the repository a ⭐ on GitHub!

[![GitHub Stars](https://img.shields.io/github/stars/mlajkim/id-jag-the-hard-way?style=social)](https://github.com/mlajkim/id-jag-the-hard-way)

If you run into any issues or have questions, feel free to [open an issue](https://github.com/mlajkim/id-jag-the-hard-way/issues).
