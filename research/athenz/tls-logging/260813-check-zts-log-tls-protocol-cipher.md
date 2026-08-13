# Goal

The goal of this document is to verify that the Athenz ZTS access log records the TLS protocol and cipher suite negotiated by Jetty, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Send a marked HTTPS request to ZTS](#step-1-send-a-marked-https-request-to-zts)
- [Step 2. Check the TLS protocol and cipher in the ZTS log](#step-2-check-the-tls-protocol-and-cipher-in-the-zts-log)

<!-- /TOC -->

<details>
<summary>Last human verified on Aug 13, 2026 — ✅ Success</summary>

| # | Date         | Confirmed Working                                               |
|---|--------------|-----------------------------------------------------------------|
| 1 | Aug 13, 2026 | ✅ Human verified — ZTS logged the TLS protocol and cipher suite |

</details>

# Prerequisites

This tutorial requires the following to be completed:

1. Complete the main [ID-JAG The Hard Way tutorial](../../../tutorials/16-id-jag.md), including the final ID-JAG step.

# Steps

Here is the procedure to get to the goals.

## Step 1. Send a marked HTTPS request to ZTS

Send an HTTPS status request from the existing Athenz CLI pod. The `tls-log-test=1` query parameter makes this request easy to find in the access log:

```sh
kubectl -n athenz exec deployment/athenz-cli -- \
  curl -skS \
    -o /dev/null \
    -w 'HTTP status: %{http_code}\n' \
    'https://athenz-zts-server.athenz:4443/zts/v1/status?tls-log-test=1'
```

```sh
# HTTP status: 200
```

## Step 2. Check the TLS protocol and cipher in the ZTS log

Find the marked request in the ZTS access log:

```sh
kubectl -n athenz logs deployment/athenz-zts-server \
  --container athenz-zts-server \
  --tail=2000 \
  | tr -d '\r' \
  | grep 'GET /zts/v1/status?tls-log-test=1 ' \
  | tail -1
```

```sh
# 10.244.0.6 - - [13/Aug/2026:09:40:29 +0000] "GET /zts/v1/status?tls-log-test=1 HTTP/1.1" 200 27 "-" "curl/8.20.0" 0 9 Auth-None TLSv1.3 TLS_AES_256_GCM_SHA384 -
```

The fields near the end show the negotiated TLS protocol and cipher suite:

```sh
TLSv1.3 TLS_AES_256_GCM_SHA384
```

that describes the security negotiated for that HTTPS connection:

  - TLSv1.3 — the TLS protocol version used.
  - AES_256 — data encrypted using AES with a 256-bit key.
  - GCM — provides encryption plus tamper detection.
  - SHA384 — used by TLS 1.3 when deriving session keys.

PR #3362 updated the Athenz request logger to read Jetty's current TLS session data. Before the fix, these two fields could appear as `- -` even though the request successfully used HTTPS.

```sh
# 10.244.0.6 - - [13/Aug/2026:09:40:29 +0000] "GET /zts/v1/status?tls-log-test=1 HTTP/1.1" 200 27 "-" "curl/8.20.0" 0 9 Auth-None - - -
```

This is the pre-fix equivalent of the captured log line for comparison; it is not a separately captured historical entry.

# Reference

- [Athenz PR #3362 — fix tls protocol/cipher log with jetty 1.12.x](https://github.com/AthenZ/athenz/pull/3362)
