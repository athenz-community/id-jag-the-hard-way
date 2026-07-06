# tools/config

Configuration files for the ID-JAG Athenz permission model.

## init.yaml

The **full reset config**. Apply it when:

- You're setting up the environment for the first time
- Things have gone sideways — wrong policies, broken roles, mystery 403s — and you want to wipe everything and start clean
- You've manually tweaked Athenz state and lost track of what's actually applied

It declares every service identity, role, member, and policy needed for the complete tutorial flow. Running it is fully destructive — it deletes the `api` domain and rebuilds it from scratch.

```sh
make -C ui setup-permissions-api
# or directly:
./tools/setup-permissions.sh tools/config/init.yaml
```

> **Order note:** run this after the `api` namespace and `api-server` deployment exist. The setup script creates cert secrets and restarts configured deployments.

### What's inside

| Role                       | Who                          | What they can do                                                |
|----------------------------|------------------------------|-----------------------------------------------------------------|
| `docs-getter`              | `human.idjag-learner`        | GET /docs                                                       |
| `docs-poster`              | `human.idjag-learner`        | POST /docs                                                      |
| `docs-deleter`             | `human.idjag-learner`        | DELETE /docs                                                    |
| `mcp-accessor`             | `human.idjag-learner`        | access the MCP auth proxy                                       |
| `docs-getter-jag-exchanger` | AI agents                   | JAG-exchange into `docs-getter`                                |
| `mcp-accessor-jag-exchanger` | AI agents                   | JAG-exchange into `mcp-accessor`                               |
| `jag-exchanging-uis`       | `org.idjag-ui`               | JAG-exchange into `docs-getter`, `docs-poster`, `docs-deleter`  |
| `to-api-exchanger`         | `api.api-mcp`                | RFC 8693 source exchange from `api` tokens                      |
| `docs-getter-exchanger`    | `api.api-mcp`                | RFC 8693 target exchange into `docs-getter` scoped tokens       |

> **Note:** AI agents intentionally do **not** get a `docs-deleter-jag-exchanger` role — they cannot delete docs on behalf of users by design.

## org.yaml

The config for the `org` domain, which owns the ID-JAG UI service identity. Apply it when setting up or resetting the UI deployment:

```sh
make -C ui setup-permissions-org
# or directly:
./tools/setup-permissions.sh tools/config/org.yaml
```

### What's inside

| Service    | K8s namespace | K8s secret      | Cert files                              |
|------------|---------------|-----------------|-----------------------------------------|
| `idjag-ui` | `org`         | `idjag-ui-cert` | `org.idjag-ui.crt` / `org.idjag-ui.key` |

The cert is mounted into the `idjag-ui` deployment at `/app/certs` so the UI can authenticate to Athenz ZTS for JAG token exchange.
