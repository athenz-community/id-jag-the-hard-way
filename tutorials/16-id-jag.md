|                    Previous                    |  Current   |                      Next                      |
|:----------------------------------------------:|:----------:|:----------------------------------------------:|
| [AI Client Gateway](./15-ai-client-gateway.md) | **ID-JAG** | *None: You are at the end of the tutorial! 🎉* |

# ID-JAG

In this tutorial, we will resolve the authorization failure from the previous step. We will configure the token exchange policies in Athenz that allow the AI Client Gateway to exchange your Keycloak ID token for an ID-JAG token on your behalf. Once those permissions are in place, you will run the same prompt again and see it succeed end-to-end.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Grant Permissions to `human.idjag-learner.claude`](#grant-permissions-to-humanidjag-learnerclaude)
- [Verify](#verify)
- [What's happened?](#whats-happened)
- [Finally](#finally)

<!-- /TOC -->

## Grant Permissions to `human.idjag-learner.claude`

The `human.idjag-learner.claude` service needs two things: permission to perform a JAG exchange on a user's behalf, and membership in the role that grants that permission.

First, create roles under the `api` and `mcp-hub` domains to represent AI agents that are allowed to perform token exchanges:

```sh
./tools/athenz/create-role.sh "api" "token-exchangable-ai-agents"
./tools/athenz/create-role.sh "mcp-hub" "token-exchangable-ai-agents"
```

In Athenz, the `zts.jag_exchange` action controls whether a principal can exchange an ID token for an ID-JAG token scoped to a given role. Grant it for `api:role.docs-getter` and `mcp-hub:role.api-mcp-accessor`:

```sh
./tools/athenz/add-policy.sh "api" "token-exchangable-ai-agents" "zts.jag_exchange" "role.docs-getter"
./tools/athenz/add-policy.sh "mcp-hub" "token-exchangable-ai-agents" "zts.jag_exchange" "role.api-mcp-accessor"
```

```sh
#   ·  Creating Policy: api:policy.zts.jag_exchange...
#   ✔  Policy created: api:policy.zts.jag_exchange
#   ·  Creating Policy: mcp-hub:policy.zts.jag_exchange...
#   ✔  Policy created: mcp-hub:policy.zts.jag_exchange
```

Now add `human.idjag-learner.claude` as a member of both roles:

```sh
./tools/athenz/add-role-member.sh "api" "token-exchangable-ai-agents" "human.idjag-learner.claude"
./tools/athenz/add-role-member.sh "mcp-hub" "token-exchangable-ai-agents" "human.idjag-learner.claude"
```

```sh
#   ·  Adding Member human.idjag-learner.claude to Role: api:role.token-exchangable-ai-agents...
#   ✔  human.idjag-learner.claude  →  api:role.token-exchangable-ai-agents
#   ·  Adding Member human.idjag-learner.claude to Role: mcp-hub:role.token-exchangable-ai-agents...
#   ✔  human.idjag-learner.claude  →  mcp-hub:role.token-exchangable-ai-agents
```

> [!NOTE]
> Notice that `human.idjag-learner.claude` does not need direct permission to fetch an Access Token for `api:role.docs-getter` or `mcp-hub:role.api-mcp-accessor`. It only needs `zts.jag_exchange` — the right to perform the token exchange on behalf of the user. The resulting scoped Access Token is what grants downstream access.

## Verify

Do:

```sh
/reload-plugins
```

Then:

```sh
/mcp
```

Select **1. Re-Authenticate** to reconnect. This time, with the token exchange permission in place, you will see the connection succeed.

Then send the same prompt that failed in the previous tutorial:

```
get docs from k8s doc server!
```

![16_successful_retrieval_from_server](./assets/16_successful_retrieval_from_server.png)

## What's happened?

Congratulations! 🎉 You have completed the full ID-JAG tutorial.

Here is a brief overview of how it all worked:

1. You signed in to Open WebUI as `idjag-learner` via Keycloak, which issued an **ID Token**.
2. The **AI Client Gateway** intercepted the request and exchanged the ID Token for an **ID-JAG token** via Athenz ZTS.
3. Athenz ZTS validated the token against the `token-exchangable-ai-agents` role and issued a scoped **Access Token**.
4. The gateway forwarded the request to the **MCP Server** with the Access Token attached.
5. The **MCP Authorization Proxy** validated the token and forwarded it to the MCP Server.
6. The MCP Server performed its own token exchange to call the **API Server**, which returned the data.

At every hop, the Principle of Least Privilege was enforced — each component only held the minimum permissions it needed.

## Finally

Thank you for following along. Hope it was helpful.

You have seen the full ID-JAG flow end-to-end: a human signs in, an AI agent acts on their behalf with a scoped identity, enterprise policy governs exactly what the agent can do, and the organization can tighten or expand those boundaries at any time — without touching application code.

If you found this tutorial useful, please consider giving the repository a ⭐ on GitHub!

[![GitHub Stars](https://img.shields.io/github/stars/mlajkim/id-jag-the-hard-way?style=social)](https://github.com/mlajkim/id-jag-the-hard-way)

If you run into any issues or have questions, feel free to [open an issue](https://github.com/mlajkim/id-jag-the-hard-way/issues).
