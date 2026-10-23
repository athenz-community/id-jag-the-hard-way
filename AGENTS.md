@./CLAUDE.md

# Repository Instructions

`CLAUDE.md` contains general repository guidance. The tutorial rules below record the intended teaching style and component responsibilities.

Before creating or revising anything under `research/`, read `research/AGENTS.md`.

## Tutorial Changes

- One code block or script should do one understandable job. Split large Kubernetes patches into steps such as attaching a proxy, sharing a token directory, configuring exchange, and routing traffic
- Make every runnable shell block independent after the stated prerequisites, in tutorials and research alike. Define or fetch all variables and temporary inputs inside the block that uses them; use fixed values inline when appropriate. Do not rely on an earlier block's variables or require the same shell session. If checks must reuse the same token, put its creation and those checks in one block
- Explain each step's purpose immediately before its command
- Immediately follow every runnable command block with a separate `sh` result block, with a blank line between them and every output line prefixed by `#`, so humans can compare their output directly. Include intentional failures, label expected examples versus captured output, and keep explanatory notes in prose
- Keep chapter 10 self-contained in each client path. Repeat the full procedure in the Codex and Open WebUI pages instead of replacing it with links to shared steps; this duplication is intentional
- Chapter 08 simply deploys `idthw-demo-api-mcp` in namespace `mcp` and verifies initialization and tool discovery. Add MCP protection in its own chapter
- The MCP application uses a supplied API access token, either configured at startup or provided by Runtime Proxy in a request-specific file. Runtime Proxy owns MCP token validation and downstream token exchange; only the proxy mounts the service identity
- Do not add forwarding modes or token-exchange logic to the MCP application to make an earlier tutorial step work
- Keep each chapter focused on its current learning goal. Next Steps should explain only the immediate next chapter, followed by a blank line and the `Next: [Chapter](./path.md)` link
- Initialize `_mcp_port=$(./tools/port.sh mcp)` in every shell block that uses `${_mcp_port}`

## Tool Output

- Inspect neighboring tools and reuse `tools/color.sh` helpers (`info`, `ok`, `warn`, `err`, and `fatal`) for progress, success, and failure messages instead of introducing another output format
