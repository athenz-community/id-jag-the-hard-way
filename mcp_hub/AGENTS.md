# MCP Hub Agent Notes

This app is a mock-first Next.js UI for an MCP Hub, but the end goal is real: providers should be able to register MCP servers and have the hub create the runtime deployment for that MCP server.

## Product Direction

- Keep PRs small. Prefer the minimum change that makes the next product step clear.
- Treat the catalog as the entry point, not the whole product.
- The main provider flow is: register MCP server -> define managed policies/tools -> create deployment/pods -> expose connection details.
- The main consumer flow is: discover MCP server -> inspect tools and managed policies -> attach/grant access through ID-JAG.
- Do not spend large PRs only polishing dummy catalog data unless it directly supports one of those flows.

## Product Goals

Users should be able to:

- See public MCP servers.
- See what tools exist for each MCP server.
- See what actions are available for those tools.
- Eventually see resources too, but actions are the first priority.
- See how to register or connect to an MCP server.

MCP providers should be able to:

- Create/register an MCP server with a container image.
- Assign a service account.
- Have MCP pods/deployments created automatically in Kubernetes.
- Have those pods health checked automatically.

Registration is a real product goal. Users/providers should eventually be able to register their MCP server through the UI, but do not introduce a database by default. Start from Kubernetes as the source of truth: deployed MCP workloads, Services, labels, and annotations should drive the catalog until there is a concrete need for draft state, audit history, approvals, or richer metadata that Kubernetes cannot reasonably hold.

## Current State

- The app is standalone under `mcp_hub/`.
- It uses Next.js 16, TypeScript, Tailwind CSS imports, and mostly hand-written CSS in `app/globals.css`.
- `make local` runs the app on port `3102`.
- The catalog page fetches MCP server rows from the local Next API route `/api/mcp-servers`.
- `/api/mcp-servers` reads Kubernetes Deployments with MCP Hub labels and maps labels/annotations into the catalog model.
- Most navigation and not-yet-implemented controls are disabled so missing surfaces are obvious.
- Public images live in `public/icons/` and are referenced as `/icons/<file>`.
- For the first real-data slice, prefer reading Kubernetes Deployments/Services with MCP Hub labels and annotations over adding a database.

## Recommended PR Order

Prefer small PRs that establish real product contracts:

1. Add a read-only MCP detail page for catalog rows.
2. Add a mock `Register MCP server` page with fields for name, project, image, transport, port, service account, replicas, tools, and managed policies.
3. Add local mock persistence for registered MCP servers.
4. Add a generated Kubernetes manifest preview from the registration form.
5. Wire a backend action/API that can create a Kubernetes Deployment and Service.
6. Add health, logs, and rollout status once deployment creation exists.

## Data Model Hints

Keep these concepts separate:

- MCP server identity: name, project, description, icon, owner/provider project.
- Runtime deployment: image, transport, port, replicas, service account, env vars, health checks.
- Managed policies: provider-owned default policy templates for tools.
- Grants/attachments: consumer/project-owned ID-JAG permissions that allow agents or users to call the MCP tools.

Initial Kubernetes metadata can be modeled with labels and annotations such as:

- `app.kubernetes.io/part-of=mcp-hub`
- `mcp.idthw.dev/alias=<optional-display-alias>` as an annotation when the alias contains spaces.
- `mcp.idthw.dev/project=<project-name>`
- `mcp.idthw.dev/description=<description>`
- `mcp.idthw.dev/transport=<transport>`
- `mcp.idthw.dev/tools=<comma-separated-actions>`

## UI Guidance

- Keep the screen operational and dense, similar to an internal control plane.
- Keep the black top bar, gray sidebar, white content area, tabbed catalog, filter row, and flat table style unless the user asks to redesign.
- Use disabled controls for planned surfaces that are not wired yet.
- Avoid company-specific names, URLs, or screenshots in source.
- Keep copy generic to IDTHW, MCP Hub, ID-JAG, Kubernetes, and Athenz.

## Commands

```sh
make local
npm run lint
npm run build
```

`npm run build` may need permission in sandboxed environments because Next/Turbopack can spawn workers and bind local ports.

## Next.js Note

This project uses Next.js 16. If framework behavior is unclear, check the installed docs or existing app patterns before assuming older Next.js conventions.
