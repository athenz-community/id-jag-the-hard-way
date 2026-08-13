# Goal

The goal of this document is to verify that the Athenz ZMS and ZTS HTTPS interfaces add the HTTP Strict Transport Security response header and demonstrate how an HSTS-aware client upgrades a later HTTP request to HTTPS, with the following steps:

<!-- TOC depthFrom:2 depthTo:2 -->

- [Step 1. Confirm ZMS and ZTS are running](#step-1-confirm-zms-and-zts-are-running)
- [Step 2. Verify HSTS on successful responses](#step-2-verify-hsts-on-successful-responses)
- [Step 3. Compare an HTTP request before and after learning HSTS](#step-3-compare-an-http-request-before-and-after-learning-hsts)
- [Step 4. Verify HSTS on error responses](#step-4-verify-hsts-on-error-responses)

<!-- /TOC -->

<details>
<summary>Last human verified on Aug 13, 2026 — ✅ Success</summary>

| # | Date         | Confirmed Working                                                                                                                      |
|---|--------------|----------------------------------------------------------------------------------------------------------------------------------------|
| 1 | Aug 13, 2026 | ✅ Human verified — ZMS and ZTS returned the expected policy on `200` and `404` responses; curl upgraded a remembered HTTP URL to HTTPS |

</details>

# Prerequisites

This tutorial requires the following to be completed:

- Complete the main [ID-JAG The Hard Way tutorial](../../../tutorials/16-id-jag.md), including the final ID-JAG step.
- Keep the tutorial's Kubernetes cluster running.
- Keep `./tools/keep-k8s-port-forward.sh` running in another terminal.
- Run all commands from the ID-JAG The Hard Way repository root.

# Steps

Here is the procedure to get to the goals.

## Step 1. Confirm ZMS and ZTS are running

Confirm that both Athenz servers are available before testing their HTTPS responses:

```sh
kubectl -n athenz get deployment athenz-zms-server athenz-zts-server
```

```sh
# NAME                READY   UP-TO-DATE   AVAILABLE   AGE
# athenz-zms-server   1/1     1            1           ...
# athenz-zts-server   1/1     1            1           ...
```

Both deployments must show `1/1` under `READY`. If they are ready but the next step cannot connect, restart `./tools/keep-k8s-port-forward.sh`.

## Step 2. Verify HSTS on successful responses

Check the unauthenticated status endpoint on ZMS:

```sh
curl -skS \
  -D - \
  -o /dev/null \
  -w 'HTTP status: %{http_code}\n' \
  "https://localhost:$(./tools/port.sh zms)/zms/v1/status"
```

```sh
# HTTP/1.1 200 OK
# Strict-Transport-Security: max-age=31536000; includeSubDomains
# Host: athenz-zms-server-b979dc499-qz6jg
# Content-Type: application/json
# Content-Length: 27

# HTTP status: 200
```

Check the same feature on ZTS `Strict-Transport-Security`:

```sh
curl -skS \
  -D - \
  -o /dev/null \
  -w 'HTTP status: %{http_code}\n' \
  "https://localhost:$(./tools/port.sh zts)/zts/v1/status"
```

```sh
# HTTP/1.1 200 OK
# Strict-Transport-Security: max-age=31536000; includeSubDomains
# Host: athenz-zts-server-...
# Content-Type: application/json
# Content-Length: 27

# HTTP status: 200
```

These checks connect to the direct ZMS and ZTS port-forwards. Therefore, the observed header comes from Athenz rather than from the Athenz UI, an ingress, or another reverse proxy. The `-k` option is intentional for this local test because ID-JAG The Hard Way uses locally generated certificates; the test is checking whether Athenz emits the header, not whether the workstation trusts the tutorial CA.

## Step 3. Compare an HTTP request before and after learning HSTS

Send an HTTP request that is not permitted by Athenz's default HTTPS-only listener:

```sh
curl -skS \
  --max-time 5 \
  -D - \
  -o /dev/null \
  -w 'Effective URL: %{url_effective}\nHTTP status: %{http_code}\n' \
  "http://localhost:$(./tools/port.sh zms)/zms/v1/status"
```

```sh
# curl: (1) Received HTTP/0.9 when not allowed
# Effective URL: http://localhost:4443/zms/v1/status
# HTTP status: 000
```

The exact curl error can vary by version. The stable result is that the effective URL remains `http://` and no HTTP response is received (`000`). This failure is not caused by HSTS: plaintext HTTP was sent to a port that expects a TLS handshake, so the request never reaches the ZMS API as a valid HTTP request.

Now create a temporary empty file that curl can use as its HSTS cache. `--hsts "${_hsts_cache}"` tells curl to read and update that file:

```sh
_hsts_cache=$(mktemp)

curl -skS \
  --hsts "${_hsts_cache}" \
  -D - \
  -o /dev/null \
  -w 'Effective URL: %{url_effective}\nHTTP status: %{http_code}\n' \
  "https://localhost:$(./tools/port.sh zms)/zms/v1/status"
```

```sh
# HTTP/1.1 200 OK
# Strict-Transport-Security: max-age=31536000; includeSubDomains
# Host: athenz-zms-server-...
# Content-Type: application/json
# Content-Length: 27

# Effective URL: https://localhost:4443/zms/v1/status
# HTTP status: 200
```

Repeat the original `http://` URL, this time with the learned HSTS cache:

```sh
curl -skS \
  --hsts "${_hsts_cache}" \
  -D - \
  -o /dev/null \
  -w 'Effective URL: %{url_effective}\nHTTP status: %{http_code}\n' \
  "http://localhost:$(./tools/port.sh zms)/zms/v1/status"
```

```sh
# HTTP/1.1 200 OK
# Strict-Transport-Security: max-age=31536000; includeSubDomains
# Host: athenz-zms-server-...
# Content-Type: application/json
# Content-Length: 27

# Effective URL: https://localhost:4443/zms/v1/status
# HTTP status: 200
```

Although the input URL used `http://`, curl changed the effective URL to `https://` before sending the request. That client-side upgrade is the protection HSTS provides against insecure fallback.

Remove the temporary curl cache:

```sh
rm -f "${_hsts_cache}"
unset _hsts_cache
```

> [!NOTE]
> The `-k` option keeps this local demonstration simple with tutorial-generated certificates. Production browsers learn HSTS only from a valid HTTPS connection. This procedure demonstrates the upgrade behavior; it does not reproduce a real man-in-the-middle or SSL-stripping attack.

## Step 4. Verify HSTS on error responses

The Athenz Jetty response-header rule applies to every request path. Use a path that does not exist and verify that the HSTS header remains present on the ZMS `404` response:

```sh
curl -skS \
  -D - \
  -o /dev/null \
  -w 'HTTP status: %{http_code}\n' \
  "https://localhost:$(./tools/port.sh zms)/zms/v1/hsts-test-not-found" \
  | tr -d '\r' \
  | grep -Ei '^(Strict-Transport-Security:|HTTP status:)'
```

```sh
# Strict-Transport-Security: max-age=31536000; includeSubDomains
# HTTP status: 404
```

Repeat the error-response check against ZTS:

```sh
curl -skS \
  -D - \
  -o /dev/null \
  -w 'HTTP status: %{http_code}\n' \
  "https://localhost:$(./tools/port.sh zts)/zts/v1/hsts-test-not-found" \
  | tr -d '\r' \
  | grep -Ei '^(Strict-Transport-Security:|HTTP status:)'
```

```sh
# Strict-Transport-Security: max-age=31536000; includeSubDomains
# HTTP status: 404
```

The four successful checks prove that both Athenz services publish the policy on normal and error responses. `max-age=31536000` asks a user agent to remember the HTTPS-only policy for one year, and `includeSubDomains` extends that policy to subdomains of the hostname that delivered it.

This test validates the deployed behavior associated with PR #3361 without depending on its internal unit tests. It does not isolate whether the value came from the Jetty container's built-in default or an explicit `athenz.response_headers_json` deployment property. Step 3 demonstrates curl's HSTS cache, not a specific browser's storage or HSTS preload behavior.

# Reference

- [Athenz PR #3361 — configure default Strict-Transport-Security header response](https://github.com/AthenZ/athenz/pull/3361)
- [RFC 6797 — HTTP Strict Transport Security](https://datatracker.ietf.org/doc/html/rfc6797)
