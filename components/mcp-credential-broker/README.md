# MCP Credential Broker

`@mlajkim/mcp-credential-broker` connects one local stdio MCP entry to one MCP Gateway route while sharing a single browser-authenticated Gateway session across all connector processes.

```text
Codex confluence entry -> broker -> /mcp/confluence --+
Codex jira entry       -> broker -> /mcp/jira --------+-> one opaque Gateway session
Codex slack entry      -> broker -> /mcp/slack -------+
```

Each MCP client entry remains separate, so clients such as Codex can show independent server connection state and tool counts. The broker does not aggregate or rename tools.

## Public npm Package

The package is published as a public scoped package on npmjs.com. Installing or running it does not require an npm account or registry token:

```sh
npx -y @mlajkim/mcp-credential-broker@latest https://mcp-gateway.example/mcp/confluence
```

Every same-repository pull request publishes a unique prerelease version and updates its `pr-<number>` tag on npm. For example, PR 208 can be tested before merge with:

```sh
npx -y @mlajkim/mcp-credential-broker@pr-208 https://mcp-gateway.example/mcp/confluence
```

Merging to `main` publishes the version from `package.json` under the `latest` tag.

## Client Configuration

After this package is published, a Codex entry can use:

```toml
[mcp_servers.confluence]
enabled = true
startup_timeout_sec = 360
command = "npx"
args = ["-y", "@mlajkim/mcp-credential-broker@latest", "https://mcp-gateway.example/mcp/confluence"]
```

JSON clients with stdio support use the same command:

```json
{
  "servers": {
    "confluence": {
      "command": "npx",
      "args": [
        "-y",
        "@mlajkim/mcp-credential-broker@latest",
        "https://mcp-gateway.example/mcp/confluence"
      ]
    }
  }
}
```

No `codex mcp login` command is required. On startup, the first broker process immediately opens the Gateway login in the default browser. Other broker processes wait for it and then reuse the same session.

For source-tree development:

```sh
make -C components/mcp-credential-broker install build
node components/mcp-credential-broker/dist/index.js \
  http://127.0.0.1:24445/mcp/k8s-docs-server
```

Non-loopback plaintext HTTP is rejected by default. A development-only Gateway can be used explicitly with `--allow-insecure-http` or `IDTHW_MCP_ALLOW_INSECURE_HTTP=true`.

## Authentication Flow

1. The broker discovers protected-resource metadata from the selected `/mcp/{routeId}` URL.
2. It discovers the Gateway authorization endpoints and verifies PKCE S256 support.
3. It dynamically registers an ephemeral loopback public client.
4. It opens Authorization Code + PKCE in the browser. MCP Gateway redirects the browser to Keycloak and retains the resulting ID token server-side.
5. The broker receives only an opaque, short-lived Gateway bearer session.
6. Each request reaches its original route. MCP Gateway resolves that route through the Kubernetes-backed MCP Hub registry and obtains the route-specific Athenz scope.

The npm/stdio broker is intentionally a **public client**. Shipping a client secret in an npm package would not make it confidential. OAuth still exists between this broker and MCP Gateway; what disappears is client-specific OAuth setup and the manual Codex login command.

## Shared Session and Security

Credentials are keyed by the discovered authorization-server issuer, not by MCP server name. The default cache is:

```text
~/.idthw/mcp-credential-broker/
```

- The directory is forced to mode `0700`; credential and lock files use `0600`.
- Credential writes use a temporary file plus atomic rename.
- An exclusive cross-process lock permits only one browser flow at a time.
- A terminated connector's old lock is reclaimed after ten minutes.
- Expired credentials are replaced, and an HTTP 401 invalidates only the matching cached token before one retry.
- ID tokens, ID-JAGs, Athenz access tokens, client secrets, authorization codes, and PKCE verifiers are never persisted.

The shared opaque session proves one signed-in human identity; it does not combine route permissions. Route-specific scope and policy enforcement stay in MCP Gateway and Athenz.

## Checks

```sh
make -C components/mcp-credential-broker check test build
```
