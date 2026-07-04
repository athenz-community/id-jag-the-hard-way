# MCP Hub

Small Next.js mock of the IDTHW MCP Hub console.

This first slice is static by design. It provides the catalog shell and dummy MCP server list so later PRs can add registration, pod creation, health checks, and provider-owned MCP metadata without changing the initial surface area.

## Local

```bash
npm install
npm run dev -- --port 3102
```
