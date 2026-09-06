# IDTHW Demo API MCP

This tutorial MCP demonstrates delegated downstream authorization for a Hub-managed MCP server. It does not perform Athenz token exchange itself and does not need access to the MCP service private key.

For each protected `tools/call`, MCP Runtime Proxy exchanges the signed-in user's incoming Athenz access token using the MCP service identity. It writes the narrowly scoped result to a unique request file and injects that path at:

```text
params._meta["mcp.idthw.dev/access-token-file"]
```

This MCP validates that the path belongs to the current tool under `/var/run/idthw-access-tokens`, reads the token immediately before the API request, and forwards it as `Authorization: Bearer <token>`. It never logs token contents. Runtime Proxy deletes the file after the tool response completes.

## Tools

| Tool | K8s Docs endpoint | Expected configured scope |
|---|---|---|
| `get_k8s_docs` | `GET /api/docs` | `api:role.docs-getter` |
| `post_k8s_doc` | `POST /api/docs` | `api:role.docs-poster` |
| `delete_k8s_doc` | `DELETE /api/docs/{doc_id}` | `api:role.docs-deleter` |

For each tool, configure these custom permission rows in MCP Hub:

1. `<signed_in_user>` in the tool role shown above.
2. `mcp-hub.mcp-gateway` in the matching `<tool-role>-jag-exchanger` role so Gateway can obtain the incoming delegated AT.
3. The exact Athenz service selected during MCP registration in the matching `<tool-role>-exchanger` role so Runtime Proxy can perform the AT-to-AT exchange.

For example, `get_k8s_docs` uses `api:role.docs-getter`, `api:role.docs-getter-jag-exchanger`, and `api:role.docs-getter-exchanger`. Saving Hub permission settings documents and checks these memberships; it does not add the members in Athenz.

## MCP Hub template values

```text
Container image: ghcr.io/mlajkim/idthw-demo-api-mcp:latest
Target port: 8080
Protocol: Streamable HTTP
Path: /mcp
Container command: leave blank
Container arguments: leave blank
Access management: MCP Hub / Athenz
```

Set `UPSTREAM_BASE_URL` only when the protected API is not available at the default `http://api-server.api:8080`.

## Local checks

```sh
make check test
make build-image
```
