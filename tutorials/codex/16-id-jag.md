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

The `human.idjag-learner.codex` service needs permission to perform a JAG exchange on a user's behalf.

First, create a role under the `api` domain to represent AI agents that are allowed to perform token exchanges (skip if already created in a previous tutorial path):

```sh
./tools/athenz/create-role.sh "api" "token-exchangable-ai-agents"
```

Grant the `zts.jag_exchange` action for `role.docs-getter` and `role.mcp-accessor`:

```sh
./tools/athenz/add-policy.sh "api" "token-exchangable-ai-agents" "zts.jag_exchange" "role.docs-getter"
./tools/athenz/add-policy.sh "api" "token-exchangable-ai-agents" "zts.jag_exchange" "role.mcp-accessor"
```

Now add `human.idjag-learner.codex` as a member of this role:

```sh
./tools/athenz/add-role-member.sh "api" "token-exchangable-ai-agents" "human.idjag-learner.codex"
```

```sh
#   ·  Adding Member human.idjag-learner.codex to Role: api:role.token-exchangable-ai-agents...
#   ✔  human.idjag-learner.codex  →  api:role.token-exchangable-ai-agents
```

> [!NOTE]
> Notice that `human.idjag-learner.codex` does not need direct permission to fetch an Access Token for `api:role.docs-getter` or `api:role.mcp-accessor`. It only needs `zts.jag_exchange` — the right to perform the token exchange on behalf of the user.

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

## What's happened?

Congratulations! 🎉 You have completed the full ID-JAG tutorial with Codex CLI.

Here is a brief overview of how it all worked:

1. You signed in via the AI Client Gateway as `idjag-learner` through Keycloak, which issued an **ID Token**.
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

[![GitHub Stars](https://img.shields.io/github/stars/athenz-community/id-jag-the-hard-way?style=social)](https://github.com/athenz-community/id-jag-the-hard-way)

If you run into any issues or have questions, feel free to [open an issue](https://github.com/mlajkim/id-jag-the-hard-way/issues).
