# Goal

The goal of this document is to define the structure and philosophy of the `research/` directory as the single source of truth (SSOT) for error outputs, troubleshooting guides, and operational procedures related to ID-JAG and its surrounding technologies, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Philosophy](#philosophy)
- [Document Template](#document-template)
- [Status Legend](#status-legend)
- [Naming Convention](#naming-convention)
- [Directory Structure](#directory-structure)
- [How to Add a New Document](#how-to-add-a-new-document)
- [Step 1. Choose the right subdirectory](#step-1-choose-the-right-subdirectory)
- [Step 2. Create the file with the date prefix](#step-2-create-the-file-with-the-date-prefix)
- [Step 3. Fill in Goal, Steps, Verification, Reference](#step-3-fill-in-goal-steps-verification-reference)
- [Step 4. Put setup work in the first steps](#step-4-put-setup-work-in-the-first-steps)
- [Step 5. Fill in the Verification block](#step-5-fill-in-the-verification-block)

<!-- /TOC -->

<details>
<summary>Last verified on Jul 9, 2026 — ✅ Success</summary>

| # | Date        | Confirmed Working                 |
|---|-------------|-----------------------------------|
| 1 | Jul 9, 2026 | ✅ — initial structure established |

</details>

## Philosophy

This directory is the **single source of truth (SSOT)** for research findings, error outputs, troubleshooting procedures, and non-obvious configuration steps related to ID-JAG and its surrounding technologies: Athenz (ZMS, ZTS, ZPU), Keycloak, MCP servers, the AI client gateway, Kubernetes, and more.

When you encounter an error, a known issue, or a hard-won configuration step, document it here instead of leaving it in Slack, a notepad, or memory. Future readers — including yourself — can find the root cause, the exact steps taken, and the outcome in one place without re-investigating from scratch.

Every document in this directory follows the same structure so that any reader can orient themselves instantly.

## Document Template

Every document must follow this exact structure:

~~~markdown
# Goal

The goal of this document is to ..., with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Setup 1. Create temporary test state](#setup-1-create-temporary-test-state)
- [Setup 2. Create another temporary dependency](#setup-2-create-another-temporary-dependency)
- [Step 1. Core reproduction step](#step-1-core-reproduction-step)
- [Step 2. Expected failure step](#step-2-expected-failure-step)
- [Clean-up 3. Clean up temporary state](#clean-up-3-clean-up-temporary-state)

<!-- /TOC -->

<details>
<summary>Last verified on Mon DD, YYYY — ✅ / 👍 / 🟡 / ❌ Status</summary>

| # | Date         | Confirmed Working       |
|---|--------------|-------------------------|
| 1 | Mon DD, YYYY | ✅ / 👍 / ❌ / 🟡 — short note |

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete the main [ID-JAG The Hard Way tutorial](../tutorials/16-id-jag.md).
1. Complete any additional feature-specific tutorial or FAQ.

# Steps

Here is the procedure to get to the goals.

## Setup 1. Create temporary test state

Create temporary roles, services, clients, aliases, metadata, or local state that are required only for the research flow.

## Setup 2. Create another temporary dependency

Create any additional temporary dependency that should be separate from the core reproduction.

## Step 1. Core reproduction step

Begin from the completed prerequisites and the temporary setup above.

## Step 2. Expected failure step

Use this form when a negative test must fail in a specific, expected way.

## Clean-up 3. Clean up temporary state

Restore any temporary clients, aliases, metadata, or local state created only for the research flow.

# Reference

*None*
~~~

**Rules:**

- `# Goal` is a standalone heading. The goal sentence goes on the next line.
- The goal sentence must end with `..., with the following steps:` so the TOC block reads as a natural continuation.
- The TOC block is generated from the `##` headings. Do not treat TOC entries as the source of truth.
- The TOC block must use `depthFrom:2 depthTo:2` so it captures only `##` headings.
- Each `##` heading is the source of truth for the generated TOC.
- The `# Steps` section must open with the sentence: *Here is the procedure to get to the goals.*
- Each reproduction/setup step is an `##` heading in the form `## Step N. Title`.
- Test setup that is not part of the core reproduction may use `## Setup N. Title`.
- Cleanup that is not part of the reproduction/setup goal may use `## Clean-up N. Title`.
- Use status icons (see [Status Legend](#status-legend)) in the verification details and result notes, not in every `##` heading.
- Put setup work in the first numbered steps. If a flow needs a token, client, role, or local variable, create or fetch it in the step where it first becomes necessary.
- Steps should use shared scripts from `tools/` when a script exists for the operation being researched.
- Use shared tools for reusable or state-changing operations. For a one-off, read-only HTTP inspection such as checking response headers, show the raw `curl` command instead of adding a single-use shell script.
- Available operation tools: `tools/keycloak/create-client.sh`, `tools/keycloak/delete-client.sh`, `tools/keycloak/get-client-secret.sh`, `tools/keycloak/get-id-token.sh`, `tools/keycloak/set-direct-access-grants.sh`, `tools/athenz/create-cert-with-root-ca.sh`, `tools/athenz/create-role.sh`, `tools/athenz/create-group.sh`, `tools/athenz/create-rfc7523-assertion.sh`, `tools/athenz/fetch-access-token-with-rfc7523.sh`, `tools/athenz/fetch-id-jag.sh`, `tools/athenz/exchange-id-token-for-id-jag.sh`, `tools/athenz/fetch-actor-token.sh`, `tools/athenz/fetch-access-token.sh`, `tools/athenz/fetch-access-token-with-id-jag.sh`, `tools/athenz/fetch-role-cert.sh`, `tools/athenz/exchange-access-token.sh`, `tools/athenz/delete-assertion.sh`, `tools/athenz/delete-policy.sh`, `tools/athenz/delete-group.sh`, `tools/athenz/delete-role.sh`, `tools/athenz/delete-role-member.sh`, `tools/athenz/delete-service.sh`, `tools/athenz/show-service.sh`, `tools/athenz/set-service-client-id.sh`.
- Expected command output should be shown as a commented `sh` block. Keep the status lines (`#   · ...`, `#   ✔ ...`, `#   ✘ ...`) and show only stable, relevant JSON claims. Preserve exact error `code` and `message` fields. Redact omitted or dynamic fields with `#   ...`; do not include raw JWTs, long tokens, `kid`, `exp`, `iat`, `jti`, `sid`, or other run-specific values unless the field itself is the subject of the research.
- Place a `<details>` block immediately after the TOC with summary `Last verified on <date> — <status>` and a table inside. This is the only place verification lives — there is no separate `# Verification` section at the bottom.
- Put `# Prerequisites` immediately after the verification `<details>` block when a document depends on completed tutorials or setup. Use the exact sentence `This tutorial requires the following to be completed:` followed by a short ordered list in dependency order. List the main ID-JAG tutorial first, then any feature-specific tutorial or FAQ. Use `1.` for each Markdown list item.
- After `# Steps` and `Here is the procedure to get to the goals.`, begin the first `##` step directly. Keep the PR link in `# Reference`; do not add separate PR name, background, or implementation-summary paragraphs before the procedure.
- The `# Reference` section is always last. Write `*None*` if there are no external references.

## Status Legend

| Icon | Meaning                                         |
|------|-------------------------------------------------|
| ✅    | Complete — verified working                     |
| 👍    | Expected failure — failed as expected           |
| 🟡   | In progress — partially complete or has caveats |
| ❌    | Blocked — known issue, no working solution yet  |

## Naming Convention

Use lowercase kebab-case, prefixed with the date (`YYMMDD`):

```
YYMMDD-<topic>.md
```

Examples:

```
260613-id-jag-errors.md
260620-keycloak-client.md
```

## Directory Structure

Organize documents under the technology they primarily concern:

```
research/
  athenz/
    certificate-san-dns-validation/ — certificate SAN-DNS validation and external validator behavior
    idjag/            — ID-JAG token exchange flows
    rfc6797-hsts/     — RFC 6797 HTTP Strict Transport Security behavior
    rfc7523-jwt-bearer/ — RFC 7523 JWT bearer authorization grants
    membership-self-renewal/ — role and group membership self-renewal behavior
    tls-logging/      — TLS protocol and cipher access-log behavior
    token_exchange/   — AT→AT token exchange flows
    ui/               — Athenz UI behavior
    user-certificates/ — Athenz user-certificate behavior and observability
  keycloak/           — Keycloak configuration and errors
```

## How to Add a New Document

Here is the procedure to get to the goals.

## Step 1. Choose the right subdirectory

Put the file under `athenz/certificate-san-dns-validation/`, `athenz/idjag/`, `athenz/membership-self-renewal/`, `athenz/rfc6797-hsts/`, `athenz/rfc7523-jwt-bearer/`, `athenz/tls-logging/`, `athenz/token_exchange/`, `athenz/ui/`, `athenz/user-certificates/`, or `keycloak/` based on the primary technology.

## Step 2. Create the file with the date prefix

Name it `YYMMDD-<topic>.md`.

## Step 3. Fill in Goal, Steps, Verification, Reference

Follow the template above. Start from the tutorial baseline, then add any setup as explicit numbered steps.

## Step 4. Put setup work in the first steps

Use `_var=` (not `local _var=`). Put boilerplate setup (`_id_token`, `_id_jag`, `_actor_id_token`) in numbered setup steps using shared scripts from `tools/`. In later steps, use operation-level scripts from `tools/` instead of inline HTTP calls. If a new operation pattern recurs across documents and no tool covers it yet, add one under `tools/`.

## Step 5. Fill in the Verification block

Update the `<details>` summary with the latest date and status, and add a row to the table inside.

# Reference

*None*
