# Goal

Register and apply the GenAI users delegation domain template to a service domain under `gen-ai.services` without editing the ZMS default `solution_templates.json`.

<!-- TOC depthFrom:2 depthTo:3 -->

- [Step 1. Load the Custom Template ConfigMap into ZMS](#step-1-load-the-custom-template-configmap-into-zms)
- [Step 2. Restart ZMS](#step-2-restart-zms)
- [Step 3. Create the Service Domain With the Template](#step-3-create-the-service-domain-with-the-template)

<!-- /TOC -->

<details>
<summary>Last verified on 2026-07-17 — ✅ Success</summary>

| # | Date       | Status                                   |
|---|------------|------------------------------------------|
| 1 | 2026-07-17 | ✅ Success — human confirmed fully tested |

</details>

# Prerequisites

- Have the local Kubernetes cluster configured for this repo.
- Have `kubectl` pointed at that cluster.
- Have the Athenz ZMS custom solution-template PR applied. It adds `athenz-zms-custom-solution-templates` and merges it with the default templates at ZMS pod startup.

# Steps

Here is the procedure to get to the goals.

## Step 1. Load the Custom Template ConfigMap into ZMS

The template is kept as a normal JSON file:

```sh
cat faqs/statics/gen-ai-users-delegation-solution-template.json
```

Load that file directly into the custom ZMS solution-template ConfigMap:

```sh
kubectl -n athenz create configmap athenz-zms-custom-solution-templates \
  --from-file=custom_solution_templates.json=faqs/statics/gen-ai-users-delegation-solution-template.json \
  --dry-run=client -o yaml | kubectl apply -f -
```

Check:

```sh
kubectl -n athenz get configmap athenz-zms-custom-solution-templates -o json | jq -r '.data["custom_solution_templates.json"]' | jq .
```

```sh
# {
#   "templates": {
#     "gen_ai_users_delegation": {
#       "metadata": {
#         "latestVersion": 1,
#         "timestamp": "2026-07-17T00:00:00.000Z",
#         "keywordsToReplace": "_cost_accountable_admin_",
#         ...
```

## Step 2. Restart ZMS

Restart ZMS so it loads the custom solution template:

```sh
kubectl -n athenz rollout restart deployment/athenz-zms-server
kubectl -n athenz rollout status deployment/athenz-zms-server
```

Expected result:

```sh
# deployment.apps/athenz-zms-server restarted
# deployment "athenz-zms-server" successfully rolled out
```

Check that ZMS sees the locally mounted custom solution template:

```sh
kubectl -n athenz exec deployment/athenz-zms-server -- ls -l /opt/athenz/zms/conf/zms_custom_solution_templates/custom_solution_templates.json
```

```sh
# lrwxrwxrwx ... /opt/athenz/zms/conf/zms_custom_solution_templates/custom_solution_templates.json -> ..data/custom_solution_templates.json
```

Check that ZMS generated the merged runtime `solution_templates.json`:

```sh
kubectl -n athenz exec deployment/athenz-zms-server -- jq -e '.templates.gen_ai_users_delegation' /var/run/athenz/zms-conf/solution_templates.json
```

```sh
# {
#   "metadata": {
#     "latestVersion": 1,
#     "timestamp": "2026-07-17T00:00:00.000Z",
#     "description": "gen ai users delegation template",
#     "keywordsToReplace": "_cost_accountable_admin_",
#     "autoUpdate": false
#   },
#   "roles": [
#     {
# ...
```

Check that ZMS is configured to read that merged runtime file:

```sh
kubectl -n athenz exec deployment/athenz-zms-server -- grep -n '^athenz.zms.solution_templates_fname=/var/run/athenz/zms-conf/solution_templates.json$' /var/run/athenz/zms-conf/zms.properties
```

```sh
# 98:athenz.zms.solution_templates_fname=/var/run/athenz/zms-conf/solution_templates.json
```

## Step 3. Create the Service Domain With the Template

Create neccesary domains for test:

```sh
./tools/athenz/create-tld.sh "flava"
./tools/athenz/create-subdomain.sh "flava" "mcp-hub"
./tools/athenz/create-subdomain.sh "flava" "context-ai"
```

Create gen ai service too:

```sh
./tools/athenz/create-tld.sh "gen-ai"
./tools/athenz/create-subdomain.sh "gen-ai" "services"
```

Finally apply the template:

```sh
_service_codes=(athenz spire mail messenger)

for _service_code in "${_service_codes[@]}"; do
  _cost_accountable_admin="${_service_code}-team-gm"

  ./tools/athenz/create-subdomain.sh \
    "${_parent_domain}" \
    "${_service_code}"

  ./tools/athenz/set-domain-template.sh \
    "${_parent_domain}.${_service_code}" \
    "gen_ai_users_delegation" \
    cost_accountable_admin="${_cost_accountable_admin}"
done
```

Expected result:

```sh
#   ·  Creating Subdomain: gen-ai.services.athenz...
#   ✔  Subdomain created: gen-ai.services.athenz
#   ·  Applying Domain Template: gen_ai_users_delegation -> gen-ai.services.athenz...
# [Template(s) successfully applied to domain]
#   ✔  Domain template applied: gen_ai_users_delegation -> gen-ai.services.athenz
#   ...
```

# FAQs

**What is an Athenz domain template?**

An Athenz domain template is a predefined bundle of domain objects. It can create roles, policies, services, and assertions with placeholders such as `_domain_` and `_cost_accountable_admin_`.

**Why use the custom solution-template ConfigMap?**

It keeps the default `solution_templates.json` unchanged. ZMS starts with the default templates when the custom ConfigMap is absent, and merges `custom_solution_templates.json` when `athenz-zms-custom-solution-templates` exists.

**Why must the ConfigMap key be `custom_solution_templates.json`?**

The current ZMS deployment sets `ZMS_CUSTOM_SOLUTION_TEMPLATES=/opt/athenz/zms/conf/zms_custom_solution_templates/custom_solution_templates.json`. The entrypoint reads that exact file path. A ConfigMap key such as `gen-ai-users-delegation-solution-template.json` can be mounted successfully, but ZMS will not read it unless the deployment's env var points to that filename.

**Why is the target domain under `gen-ai.services`?**

This template is intended for service-specific GenAI user-delegation domains. The service code is the final domain component, so `athenz` maps to the Athenz domain `gen-ai.services.athenz`.

**What template parameters are required?**

`cost_accountable_admin` is the member added to `role.cost-accountable-admins` in the target service domain. In the batch example, each service derives it as `<service>-team-gm`, such as `athenz-team-gm`, `spire-team-gm`, `mail-team-gm`, and `messenger-team-gm`.

**What if the create command returns `validateSolutionTemplates: Template not found: gen_ai_users_delegation`?**

First check that the generated file contains the custom template:

```sh
kubectl -n athenz exec deployment/athenz-zms-server -- jq -e '.templates.gen_ai_users_delegation' /var/run/athenz/zms-conf/solution_templates.json
```

Then check that ZMS is configured to read that generated file:

```sh
kubectl -n athenz exec deployment/athenz-zms-server -- grep -n '^athenz.zms.solution_templates_fname=/var/run/athenz/zms-conf/solution_templates.json$' /var/run/athenz/zms-conf/zms.properties
```

If `curl` fails with HTTP `000` immediately after a rollout, wait until `curl -k https://localhost:$(./tools/port.sh zms)/zms/v1/status` returns HTTP `200`, then retry the loop.

**Can I load multiple custom solution templates?**

Yes. Put all custom templates under the same top-level `templates` object in the file mounted as `custom_solution_templates.json`:

```sh
kubectl -n athenz create configmap athenz-zms-custom-solution-templates \
  --from-file=custom_solution_templates.json=faqs/statics/combined-custom-solution-templates.json \
  --dry-run=client -o yaml | kubectl apply -f -
```

If a custom template uses the same name as a default template, the custom definition wins.

**What should `gen-ai-users` contain?**

`gen-ai-users` should contain human principals such as `user.<name>`. AI tools or gateway services should not be added as normal user members.

**What does the template create?**

It creates the standard GenAI roles and policies for a service domain:

- `role.cost-accountable-admins`
- `role.gen-ai-users`
- `role.gen-ai-users-manager`
- `role.gen-ai-users-jag-exchanger` with `flava.context-ai.*`, `flava.mcp-hub.*`, and `home.*` as default members
- `policy.cost-accountable-admins-policy` lets `cost-accountable-admins` update `gen-ai-users-manager` and `gen-ai-users`
- `policy.gen-ai-users-manager-policy` lets `gen-ai-users-manager` update `gen-ai-users`
- `policy.gen-ai-users-jag-exchanger-policy` grants `zts.jag_exchange` into `gen-ai-users`
- The template does not grant membership updates on `gen-ai-users-jag-exchanger`

**How do I remove the custom template?**

Delete the custom ConfigMap and restart ZMS:

```sh
kubectl -n athenz delete configmap athenz-zms-custom-solution-templates
kubectl -n athenz rollout restart deployment/athenz-zms-server
kubectl -n athenz rollout status deployment/athenz-zms-server
```

# Reference

- [GenAI users delegation solution template](./statics/gen-ai-users-delegation-solution-template.json)
- [Athenz ZMS custom solution templates](../athenz_dist/kubernetes/athenz-zms-server/README.md)
