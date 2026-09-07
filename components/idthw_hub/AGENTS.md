# IDTHW Hub Agent Notes

This full-stack Next.js application is the IDTHW Hub. It hosts multiple product surfaces and server-side APIs. MCP Hub remains one product inside it, alongside Gen AI and future IDTHW products.

The MCP Hub is mock-first, but its end goal is real: providers should be able to register MCP servers and have the hub create the runtime deployment for that MCP server.

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

- The app is standalone under `components/idthw_hub/`.
- It uses Next.js 16, TypeScript, Tailwind CSS imports, and mostly hand-written CSS in `app/globals.css`.
- `make local` runs the app on port `3102`.
- The catalog page fetches MCP server rows from the local Next API route `/api/mcp-servers`.
- `/api/mcp-servers` reads Kubernetes Deployments with MCP Hub labels and maps labels/annotations into the catalog model.
- `/api/mcp-servers` is also the service-authenticated registry contract used by MCP Gateway; it returns each stable route ID and Core MCP Proxy URL.
- `/api/mcp-cache-status` keeps an empty Hub access-token-cache field for compatibility and aggregates sanitized MCP Gateway OAuth-session metadata with separate access-token and ID-JAG cache summaries from `MCP_HUB_GATEWAY_STATUS_URL`. Both access-token and ID-JAG entries include only audiences, scope, cache time, expiry, and status. It must never expose token or session credential values.
- The Tools page calls the running MCP server with JSON-RPC `tools/list` without an Athenz access token; Kubernetes annotations are not the source of truth for tools. Protocol bootstrap and tool discovery are public, while `tools/call` remains protected.
- Hub-managed deployments probe Runtime Proxy `/healthz` for liveness and `/readyz` for readiness. Runtime Proxy readiness runs the MCP-standard `initialize`, `notifications/initialized`, `ping`, and `tools/list` lifecycle against the colocated MCP container. Catalog status is derived from the Kubernetes Deployment rollout/readiness state: `Active`, `In progress`, or `Unhealthy`.
- Curated custom permission requirements start as pure settings in `config/permission-presets.yaml`. `make local` generates the `mcp-hub-permission-presets` Kubernetes ConfigMap from that file. Authenticated Hub users can override one tool's requirements from its permission dialog; those partial overrides are stored in the MCP Deployment's `mcp.idthw.dev/tool-permissions` annotation and take precedence over the checked-in defaults. The client-configuration page checks current direct role memberships through ZMS with the Hub's server-side certificate. Athenz remains the source of truth for real membership.
- Creating a Hub-managed MCP server uses that same server-side certificate to idempotently provision a server-specific access path in the existing `mcp-hub.mcps.<project>` domain: an initially empty `<mcp-key>-accessor` role, the `<mcp-key>-accessor-jag-exchanger` role with `mcp-hub.mcp-gateway`, the `zts.jag_exchange` policy from that exchanger role to the access role, and the `<mcp-key>-accessor-source-exchanger` role with the selected MCP service account. Creation and update never add the signed-in user to the accessor role; the creator must use the same client-configuration access request as every other user. Saving a signed-in-user tool audience adds an idempotent `zts.token_source_exchange` assertion for that target domain to the server-specific source-exchange policy. The Hub verifies that the selected service exists, generates a dedicated RSA service key, registers its public key under the deterministic per-server key ID `idthw-hub-<mcp-key>` (truncated with a stable hash when necessary), and enables the `zts_instance_launch_provider` template for that service; it never creates the project domain. Multiple MCP servers may share one Athenz service account because their access roles, exchange policies, and public-key IDs are distinct. Updates preserve legacy key IDs already stored in Runtime Proxy configuration.
- The Hub-managed client-configuration flow starts with an authenticated access request. `POST /api/mcp-servers/<mcp-key>/access` adds the current signed-in user to that server's access role and idempotently creates or repairs its managed roles, memberships, JAG policy, and configured source-exchange assertions. It also reconciles a legacy shared Deployment scope to the per-server scope before the UI proceeds to permission verification and client configuration. It never deletes legacy Athenz roles or policies.
- Confirmed deletion of a Hub-managed MCP server removes that MCP's three server-specific access roles and its JAG/source-exchange policies before deleting the Kubernetes resources. It must not delete the project-owned Athenz service account, project domain, or legacy shared access resources.
- Hub-managed creation and update also idempotently apply the project-local `mcp-runtime-proxy-athenz-ca` ConfigMap from the Hub's configured Athenz CA. New Hub-managed servers store their private key in an immutable bootstrap Secret mounted only by Runtime Proxy. Runtime Proxy obtains an X.509 service certificate from ZTS, publishes the cert/key through a separate Secret mounted read-only by both Runtime Proxy and the MCP container at `/var/run/athenz/service.{cert,key}.pem`, and refreshes it every 24 hours using a resource-name-scoped Kubernetes Role. Both containers also receive the Athenz CA as `/var/run/athenz/ca.crt` and `/var/run/athenz/ca.cert.pem`. Runtime Proxy validates protected requests against the ZTS JWKS endpoint, exact managed audience, token expiry, and the server-specific `<mcp-key>-accessor` scope without downloading Athenz policy. Protocol bootstrap, `ping`, and `tools/list` remain public.
- For configured custom tool scopes, MCP Gateway sends only the scope outside the managed route scope through the internal downstream-scope header. Runtime Proxy verifies those scopes exist in the signed incoming AT, performs mTLS token exchange with the managed MCP service identity, publishes the exchanged AT at `/var/run/idthw-access-tokens/<tool>/<request-id>.jwt`, passes the exact path through MCP request `_meta`, and removes it after the response. The shared `emptyDir` is read/write only for Runtime Proxy and read-only for the MCP container. Do not replace the request-scoped layout with a shared per-tool file because concurrent users would overwrite each other.
- Permission setup must enumerate tools from the public live MCP `tools/list` result, not from the preset. The YAML plus Deployment overrides map custom execution requirements onto those tool names. Hub-managed user, Gateway, and MCP source-exchanger requirements are generated from the deployment's managed access scope and merged into every discovered tool. Permission dialogs show editable custom **Tool permissions** first and read-only **MCP access** defaults at the bottom; auto-expand the managed-default section only when a managed membership or policy is missing. Each direct requirement leads with its audience/Athenz domain and role. For Hub-managed servers, render the derived Gateway `<role>-jag-exchanger` and MCP-service `<role>-exchanger` memberships immediately below and indented from each owning direct-access row, before the final **Add permission** control. Edit mode should mirror the visible permission table: each helper keeps its editable member and role together with zero or more editable policies containing effect, action, and resource. Do not use a helper enable/disable checkbox. Each helper and each associated policy can be added or deleted, and helpers can target MCP Gateway, the selected MCP IAM account, or a custom service account. Keep **Add policy** compact and inside its helper. An empty helper list offers **Generate default helpers**; a customized list can reset to defaults. Saving persists these helper policy expectations and provisions only the managed source-domain exchange assertion; it does not provision downstream target-domain role memberships or submit a permission request.
- Hub-managed server creation optionally accepts known tool names and their downstream permission requirements immediately after IAM service-account selection, using the same direct/helper/policy editor as the live Tools page. This setup remains optional because live tools may not be known until deployment. Templates can store the same settings as defaults; template-based creation inherits them, lets the provider customize or remove them, and stores the final settings in the Deployment's `mcp.idthw.dev/tool-permissions` annotation. Creation and server update idempotently provision the corresponding managed source-exchange audience assertions, while downstream memberships remain external Athenz grants.
- `/api/mcp-servers` derives `toolScopes` from each configured tool's `<signed_in_user>` roles and merges the deployment's managed route scope into each one. It also publishes `accessAudience`, defaulted from the first route-scope domain; Hub-managed manifests record the managed MCP domain explicitly so it matches Runtime Proxy's expected audience. MCP Gateway uses that audience for multi-domain Athenz access-token issuance, uses the exact `tools/call.params.name` scope mapping, and fails closed for an unmapped tool whenever a server has a configured map. Servers without `toolScopes` use the Kubernetes `access-scope` annotation for protected calls.
- On the client-configuration page, always keep up to five tool permission rows visible. When there are more than five tools, place only the remaining rows behind an `Expand tools` control so the next setup step remains immediately visible. Keep the expand/collapse control after the currently displayed tool rows.
- Permission detail dialogs use a compact table. The Athenz role value itself is the outbound link; do not add a redundant `Open in Athenz` action beside it.
- `<signed_in_user>` is the only supported dynamic permission-preset member. It must occupy the complete `member` value. Unknown or partial placeholders are configuration errors and must never be skipped in a way that could produce a false ready state.
- Most navigation and not-yet-implemented controls are disabled so missing surfaces are obvious.
- Public images live in `public/icons/` and are referenced as `/icons/<file>`.
- Selectable MCP server and template icons live in `public/mcp_icons/`. Resources store only the image filename ID in `mcp.idthw.dev/icon`; missing or unknown IDs fall back to name initials. A selected template icon is the default for servers created from that template.
- Selecting a template during MCP server creation shows the template's container source, image, port, protocol, path, command, and arguments in the same layout as direct setup, but those template-owned values are read-only. Direct MCP server creation does not suggest container images; template authoring retains its curated image suggestions.
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
- `mcp.idthw.dev/id=<globally-unique-route-id>` is the stable ID used in `/mcp/{id}`; it defaults to the deployment name.
- `mcp.idthw.dev/access-scope=<space-separated-Athenz-scopes>` optionally tells MCP Gateway which per-user AT scope to request for this route.
- `mcp.idthw.dev/project=<project-name>` is required for catalog listing.
- `mcp.idthw.dev/description=<description>`
- `mcp.idthw.dev/public-url=<externally-reachable-mcp-url>` for client configuration and live tool discovery.
- `mcp.idthw.dev/transport=<transport>`

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
