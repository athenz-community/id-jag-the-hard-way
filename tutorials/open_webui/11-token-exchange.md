|              Previous               |             Current             |                       Next                       |
|:-----------------------------------:|:-------------------------------:|:------------------------------------------------:|
| [AI Client Agent](./10-ai-agent.md) | **Token Exchange — Open WebUI** | [Protect MCP Server](./12-protect-mcp-server.md) |

# Token Exchange — Open WebUI

In this section, we will resolve the "Not Authorized for Token Impersonation" error from the previous step. This occurred because the MCP server attempted to exchange the Access Token it received from the AI client for a new one, but lacked the necessary permissions.

By implementing the OAuth 2.0 Token Exchange ([RFC 8693](https://www.rfc-editor.org/rfc/rfc8693.html)) mechanism, we will authorize the MCP server to exchange the user's Access Token and act on their behalf to access the API server.

<!-- TOC depthFrom:2 depthTo:2 -->

- [Allow MCP Server to Exchange the Given Access Token](#allow-mcp-server-to-exchange-the-given-access-token)
- [Verify](#verify)
- [What's happened?](#whats-happened)
- [What's next?](#whats-next)

<!-- /TOC -->

## Allow MCP Server to Exchange the Given Access Token

Even if the original requester has `get` access to the `api:docs` resource, it doesn't mean just anyone can exchange the Access Token on their behalf. We must create a dedicated role specifically to allow token impersonation (exchange).

Let's add the role `api:role.token-exchanging-mcp`. As the name implies, members of this role are authorized to exchange Access Tokens for the target scope `api:role.docs-getter`:

```sh
./tools/athenz/create-role.sh "api" "token-exchanging-mcp"
```

Check if the role is created in Athenz UI:

```sh
_athenz_ui_port=$(./tools/port.sh athenz-ui)
./tools/open.sh "http://localhost:${_athenz_ui_port}/domain/api/role/token-exchanging-mcp/members"
```

![11_check_new_role](./assets/11_check_new_role.png)

In Athenz, you must explicitly define both the **source** and **target** of the token exchange.

For this step, the source is also `api`. That is okay because the MCP server is exchanging an Access Token that was already issued by the `api` domain. In other words, the `api` domain is trusting its own token as the source token. The target policy still keeps the result narrow: the exchanged token can only target `api:role.docs-getter`.

```sh
./tools/athenz/add-policy.sh "api" "token-exchanging-mcp" "zts.token_source_exchange" "api"
./tools/athenz/add-policy.sh "api" "token-exchanging-mcp" "zts.token_target_exchange" "api:role.docs-getter"
```

![11_source_and_target_exchange_policy](assets/11_source_and_target_exchange_policy.png)

> [!NOTE]
> Note that the MCP server itself doesn't need direct access to the target resource; it only needs permission to perform the exchange.

Finally, add the member you want to authorize for the token exchange (in this case, the `mcp-hub.api-mcp` service principal):

```sh
./tools/athenz/add-role-member.sh "api" "token-exchanging-mcp" "mcp-hub.api-mcp"
```

## Verify

Follow the steps below to verify the setup.

Fetch a fresh Athenz Access Token to ensure it hasn't expired:

```sh
_scope="api:role.docs-getter"
_my_access_token=$(./tools/athenz/fetch-access-token.sh \
  "./keys/idjag-learner.crt" \
  "./keys/idjag-learner.key" \
  "${_scope}" \
  "./keys/api_docs-getter.jwt")

cat "./keys/api_docs-getter.jwt"
```

Navigate to `User Icon` > `Admin Panel` > `Settings` > `Integrations`, and click the configure icon for the API MCP Server.

Attach the access token exactly as we did previously:

![11_attach_access_token](./assets/11_attach_access_token.png)

Now, ask the AI Agent the exact same prompt that failed last time:

```
get docs!
```

![11_succcesfully_get_docs_through_ai_for_the_first_time](./assets/11_succcesfully_get_docs_through_ai_for_the_first_time.png)

## What's happened?

By introducing a specific role `token-exchanging-mcp` that authorizes `mcp-hub.api-mcp` to perform token exchanges for a target scope, the MCP server can successfully exchange (Step 7 below) the provided Access Token for a new one, as illustrated below:

![11_arc_success_to_token_exchange](./assets/11_arc_success_to_token_exchange.png)

## What's next?

As shown in the architecture above, our API Server is now fully protected by Athenz Access Tokens. However, the MCP server itself remains unprotected, meaning anyone can access it. While the core API is secure, leaving the MCP server exposed is a bad security practice.

In the next section, we will implement an authentication layer for the MCP server to ensure only authenticated users can interact with it.

Next: [Protect MCP Server](./12-protect-mcp-server.md)
