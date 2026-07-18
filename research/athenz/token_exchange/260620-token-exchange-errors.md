# Goal

The goal of this document is to reproduce each known error response from Athenz ZTS during the AT→AT token exchange, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Fetch an access token](#step-1-fetch-an-access-token)
- [Step 2. Collect error cases](#step-2-collect-error-cases)

<!-- /TOC -->

<details>
<summary>Last verified on Jun 20, 2026 — 🟡 In Progress</summary>

| # | Date         | Confirmed Working                            |
|---|--------------|----------------------------------------------|
| 1 | Jun 20, 2026 | 🟡 — stub created; error catalog in progress |

</details>

# Steps

Here is the procedure to get to the goals.

## Step 1. Fetch an access token

Complete the main tutorial through [16-id-jag.md](../../../tutorials/16-id-jag.md), then fetch a valid `_at` access token:

```sh
_at=$(./tools/athenz/fetch-access-token.sh \
  ./keys/idjag-learner.crt \
  ./keys/idjag-learner.key \
  "api:role.docs-getter api:role.mcp-accessor")
```

## Step 2. Collect error cases

> [!NOTE]
> This document is a stub. Error cases will be added here as they are discovered during AT→AT token exchange experiments.

Known errors to document:

- `{"code":400,"message":"Invalid subject token: missing may_act claim"}` — see [260614-no-may-act-error.md](./260614-no-may-act-error.md)

# Reference

- [260614-no-may-act-error.md](./260614-no-may-act-error.md) — missing may_act claim error
- [RFC 8693 — Token Exchange](https://datatracker.ietf.org/doc/html/rfc8693)
