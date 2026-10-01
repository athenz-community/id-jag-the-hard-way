# ID-JAG The Hard Way

*Build Cross-App Access for AI agents with ID-JAG, the hard way.*

Build an AI agent that accesses protected APIs on behalf of a signed-in user. You will configure identities, policies, and token exchanges step by step, then use intentional failures to understand where authorization is enforced.

The tutorial uses Identity Assertion JWT Authorization Grant (ID-JAG), an [IETF draft specification](https://datatracker.ietf.org/doc/draft-ietf-oauth-identity-assertion-authz-grant/) used in Cross-App Access (XAA). For an introduction, see the [ID-JAG overview on the LY Tech Blog](https://techblog.lycorp.co.jp/en/20260417a).

[![Start Tutorial](./assets/start-tutorial-glow.svg)](./tutorials/01-working-directory.md)<br>
[![한국어](./assets/start-tutorial-korean.svg)](./tutorials/korean/00-README.md) [![日本語](./assets/start-tutorial-japanese.svg)](./tutorials/japanese/00-README.md) ![中文 — Upcoming](./assets/start-tutorial-chinese.svg)

## What You Will Build

By the end of this tutorial, you will be able to sign in through Keycloak and ask an AI agent to retrieve documents from an API running in your local Kubernetes cluster:

![ID-JAG The Hard Way Demo - Claude](./assets/id-jag-demo-claude.gif)

The same authorization path can also be driven through the Open WebUI flow:

![ID-JAG The Hard Way Demo](./assets/id-jag-demo.gif)

In both flows:

1. **You** sign in and ask the AI agent to retrieve documents.
2. The **AI Client Gateway** obtains a scoped access token on your behalf and forwards the tool call to the MCP service.
3. **MCP Runtime Proxy** validates the incoming token and exchanges it for an API access token. The **MCP server** reads that token from a request-specific file and calls the API.
4. The **Resource Server** validates the exchanged token and checks the scope required by the operation.

<a id="technical-spec"></a>

## Components

The tutorial uses the following components:

<table>
  <tr>
    <td align="center" width="25%">
      <img src="./assets/readme/claude.png" alt="Claude" width="180"><br>
      <img src="./assets/readme/codex.png" alt="Codex" width="180"><br>
      <img src="./assets/readme/open-webui.png" alt="Open WebUI" width="180">
    </td>
    <td align="center" width="25%"><img src="./assets/readme/k8s.png" alt="Kubernetes" width="96"></td>
    <td align="center" width="25%"><img src="./assets/readme/athenz.png" alt="Athenz" width="180"></td>
    <td align="center" width="25%"><img src="./assets/readme/keycloak.png" alt="Keycloak" width="160"></td>
  </tr>
  <tr>
    <td><strong>AI clients</strong><br>Claude, Codex, and Open WebUI drive MCP tool calls.</td>
    <td><strong>Runtime</strong><br>Kubernetes hosts the API, MCP, gateway, and authorization components.</td>
    <td><strong>Authorization</strong><br>Athenz ZMS/ZTS evaluates policy, issues ID-JAG, and mints scoped access tokens.</td>
    <td><strong>Identity Provider (IdP)</strong><br>Keycloak provides the signed-in human identity through OIDC.</td>
  </tr>
</table>

## Full Architecture

The diagram leads with architecture roles. This tutorial uses Keycloak as the IdP and Athenz for both the IdP AS (ID-JAG issuance) and Authorization Server (AS, access-token issuance and exchange). Other products can fill these roles if they support the required protocols and policies.

![Core tutorial architecture: IdP, IdP AS, Authorization Server, AI Agent, gateway, MCP, and Resource Server](./tutorials/assets/core_15_idjag_flow.svg)

1. The user signs in through Keycloak and sends a prompt to the AI client.
2. AI Client Gateway resolves the user's ID token from the signed-in session.
3. The gateway authenticates to Athenz ZTS and requests an ID-JAG for the required MCP and API scopes.
4. ZTS validates the ID token and checks whether the user and gateway are authorized for those scopes.
5. The gateway exchanges the ID-JAG for an access token with audience `mcp` and forwards the tool call.
6. MCP Runtime Proxy validates the token, checks `mcp:role.mcp-accessor`, and exchanges it for an API token using the MCP service identity.
7. The proxy supplies a request-specific token file to `idthw-demo-api-mcp`, which calls the API with audience `api` and scope `api:role.docs-getter`.
8. The Resource Server validates the exchanged token and checks the required scope before returning documents.

The diagram shows the default Claude Code path. Codex and Open WebUI use their own AI Client Gateway service identities.

## Philosophy

Read about the tutorial's approach to learning through intentional failures:

[ID-JAG The Hard Way: Learning AI agent authorization through failure - LY Tech Blog](https://techblog.lycorp.co.jp/en/20260526a)

## Special Thanks

The name and approach of this tutorial series are inspired by [kelseyhightower/kubernetes-the-hard-way](https://github.com/kelseyhightower/kubernetes-the-hard-way).

## Recognitions

ID-JAG The Hard Way is listed on the [OAuth.net Cross-App Access (XAA) page](https://oauth.net/cross-app-access/) as a test tool for learning ID-JAG.

![OAuth.net Cross-App Access test tools listing ID-JAG The Hard Way](assets/oauth-net-xaa-recognition.png)

The foundational ID-JAG article behind ID-JAG The Hard Way is listed under [External Resources on Okta's xaa.dev](https://xaa.dev/docs/resources#external-resources).

![Okta's xaa.dev External Resources listing the LY Corp Tech Blog article on ID-JAG](assets/xaa-dev-external-resources-recognition.png)

Want to try XAA without building everything from scratch? Visit **XAA.dev** at <https://xaa.dev/> or [launch the live demo](https://app.xaa.dev?auto_connect=todo0) to run a preconfigured ID-JAG flow in seconds—no account or local setup required.

## Community Mentions

> [!NOTE]
> If you reference this tutorial, let us know by opening an issue or pull request. We’ll add it here in the order submissions are received.

| # |     Date     | Community                                                                                                 |
|:-:|:------------:|:----------------------------------------------------------------------------------------------------------|
| 3 | Aug 29, 2026 | [dorsha/awesome-cross-app-access][260829-community] - Github                                              |
| 2 | Jul 28, 2026 | [Authorization Challenges in the AI Agent Era: What Is ID-JAG and Why?][260728-community] — DEV Community |
| 1 | Jul 23, 2026 | [[學習心得][Golang] AI Agent 時代的授權難題：ID-JAG 是什麼？為什麼我用 Go 重新實作了一次][260723-community] |

[260829-community]: https://github.com/dorsha/awesome-cross-app-access
[260723-community]: https://www.evanlin.com/id-jag-mcp-go/
[260728-community]: https://dev.to/gde/learning-notesgolang-authorization-challenges-in-the-ai-agent-era-what-is-id-jag-and-why-i-jfb

## ⭐ Community Growth

ID-JAG The Hard Way grows across both the root repository and the Athenz community fork. The star and fork counts below are updated from GitHub data.

| Repository                                                                       | Stars                                                                                                                                                                                                   | Forks                                                                                                                                                                                              |
|----------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| [Root repository](https://github.com/mlajkim/id-jag-the-hard-way)                | [![Root repository stars](https://img.shields.io/github/stars/mlajkim/id-jag-the-hard-way?style=flat-square&label=stars)](https://github.com/mlajkim/id-jag-the-hard-way/stargazers)                    | [![Root repository forks](https://img.shields.io/github/forks/mlajkim/id-jag-the-hard-way?style=flat-square&label=forks)](https://github.com/mlajkim/id-jag-the-hard-way/forks)                    |
| [Athenz community fork](https://github.com/athenz-community/id-jag-the-hard-way) | [![Athenz community stars](https://img.shields.io/github/stars/athenz-community/id-jag-the-hard-way?style=flat-square&label=stars)](https://github.com/athenz-community/id-jag-the-hard-way/stargazers) | [![Athenz community forks](https://img.shields.io/github/forks/athenz-community/id-jag-the-hard-way?style=flat-square&label=forks)](https://github.com/athenz-community/id-jag-the-hard-way/forks) |

If this tutorial helped you, a ⭐ on either repository means a lot — it helps others find it too!

Have a question or a problem? [Open an issue](https://github.com/mlajkim/id-jag-the-hard-way/issues).

Start with the working directory setup:

[![Start Tutorial](./assets/start-tutorial-glow.svg)](./tutorials/01-working-directory.md)<br>
[![한국어](./assets/start-tutorial-korean.svg)](./tutorials/korean/00-README.md) [![日本語](./assets/start-tutorial-japanese.svg)](./tutorials/japanese/00-README.md) ![中文 — Upcoming](./assets/start-tutorial-chinese.svg)
