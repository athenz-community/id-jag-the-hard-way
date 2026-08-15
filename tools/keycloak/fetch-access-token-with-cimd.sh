#!/usr/bin/env bash
set -euo pipefail

# Complete the local CIMD Authorization Code flow with PKCE and return the
# resulting Keycloak access token. With --open, open an authorization request
# for the supplied clientId and exit without waiting for a callback. Diagnostics
# go to stderr; the default flow writes only the raw access token to stdout.

TOOLS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${TOOLS_DIR}/color.sh"

_keycloak_port=$("${TOOLS_DIR}/port.sh" keycloak)
_realm=$("${TOOLS_DIR}/config.sh" keycloak realm)
_client_id=$("${TOOLS_DIR}/config.sh" keycloak cimd client-id)
_redirect_uri=$("${TOOLS_DIR}/config.sh" keycloak cimd redirect-uri)
_callback_host=$("${TOOLS_DIR}/config.sh" keycloak cimd callback-host)
_callback_port=$("${TOOLS_DIR}/config.sh" keycloak cimd callback-port)
_open_only=false

case "$#" in
  0)
    ;;
  2)
    case "$1" in
      --client-id)
        _client_id=$2
        ;;
      --open)
        _open_only=true
        _client_id=$2
        ;;
      *)
        fatal "Usage: $0 [--client-id <client_id> | --open <client_id>]"
        ;;
    esac
    ;;
  *)
    fatal "Usage: $0 [--client-id <client_id> | --open <client_id>]"
    ;;
esac

if [ -z "${_client_id}" ]; then
  fatal "The client_id must not be empty."
fi

_code_verifier=$(
  openssl rand -base64 48 \
    | tr '+/' '-_' \
    | tr -d '=\n'
)

_code_challenge=$(
  printf '%s' "${_code_verifier}" \
    | openssl dgst -sha256 -binary \
    | openssl base64 -A \
    | tr '+/' '-_' \
    | tr -d '='
)

_state=$(openssl rand -hex 16)
_encoded_client_id=$(printf '%s' "${_client_id}" | jq -sRr @uri)
_encoded_redirect_uri=$(printf '%s' "${_redirect_uri}" | jq -sRr @uri)
_authorization_url="http://localhost:${_keycloak_port}/realms/${_realm}/protocol/openid-connect/auth?response_type=code&client_id=${_encoded_client_id}&redirect_uri=${_encoded_redirect_uri}&scope=openid%20profile&state=${_state}&code_challenge=${_code_challenge}&code_challenge_method=S256"

if [ "${_open_only}" = true ]; then
  info "Opening the Keycloak CIMD authorization request for ${_client_id}..." >&2
  "${TOOLS_DIR}/open.sh" "${_authorization_url}" >&2
  exit 0
fi

_callback_output=$(mktemp)
_callback_pid=''

cleanup() {
  if [ -n "${_callback_pid}" ] && kill -0 "${_callback_pid}" 2>/dev/null; then
    kill "${_callback_pid}" 2>/dev/null || true
  fi
  rm -f "${_callback_output}"
}
trap cleanup EXIT INT TERM

python3 - "${_callback_host}" "${_callback_port}" "${_state}" >"${_callback_output}" <<'PY' &
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs, urlparse
import html
import sys

host = sys.argv[1]
port = int(sys.argv[2])
expected_state = sys.argv[3]


class CallbackHandler(BaseHTTPRequestHandler):
    callback_received = False
    callback_error = ""
    authorization_code = ""

    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/__ready":
            self.send_response(204)
            self.end_headers()
            return

        if parsed.path != "/callback":
            self.send_response(404)
            self.end_headers()
            return

        parameters = parse_qs(parsed.query)
        returned_state = parameters.get("state", [""])[0]
        code = parameters.get("code", [""])[0]
        error = parameters.get("error", [""])[0]
        error_description = parameters.get("error_description", [""])[0]

        CallbackHandler.callback_received = True

        if error:
            CallbackHandler.callback_error = error_description or error
            status = 400
            title = "Authorization failed"
            message = CallbackHandler.callback_error
        elif returned_state != expected_state:
            CallbackHandler.callback_error = "The returned OAuth state did not match."
            status = 400
            title = "Authorization state mismatch"
            message = CallbackHandler.callback_error
        elif not code:
            CallbackHandler.callback_error = "The callback did not include an authorization code."
            status = 400
            title = "Authorization callback is incomplete"
            message = CallbackHandler.callback_error
        else:
            CallbackHandler.authorization_code = code
            status = 200
            title = "Authorization successful"
            message = "Return to the terminal to continue the CIMD research."

        body = f"""<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><title>{html.escape(title)}</title></head>
  <body>
    <h1>{html.escape(title)}</h1>
    <p>{html.escape(message)}</p>
    <p>You may close this tab.</p>
  </body>
</html>
""".encode()

        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        return


server = HTTPServer((host, port), CallbackHandler)
while not CallbackHandler.callback_received:
    server.handle_request()

if CallbackHandler.callback_error:
    print(CallbackHandler.callback_error, file=sys.stderr)
    raise SystemExit(1)

print(CallbackHandler.authorization_code)
PY
_callback_pid=$!

_listener_ready=false
for _attempt in {1..50}; do
  if curl -sS --max-time 1 -o /dev/null "http://${_callback_host}:${_callback_port}/__ready"; then
    _listener_ready=true
    break
  fi

  if ! kill -0 "${_callback_pid}" 2>/dev/null; then
    break
  fi

  sleep 0.1
done

if [ "${_listener_ready}" != true ]; then
  fatal "The CIMD callback listener failed to start on ${_callback_host}:${_callback_port}."
fi

info "Opening the Keycloak CIMD authorization request..." >&2
"${TOOLS_DIR}/open.sh" "${_authorization_url}" >&2
info "Waiting for the authorization callback..." >&2

if ! wait "${_callback_pid}"; then
  _callback_pid=''
  fatal "The Keycloak authorization callback failed."
fi
_callback_pid=''

_authorization_code=$(<"${_callback_output}")
if [ -z "${_authorization_code}" ]; then
  fatal "The Keycloak callback did not return an authorization code."
fi

ok "Authorization code received and state verified." >&2
"${TOOLS_DIR}/keycloak/fetch-access-token.sh" \
  "${_authorization_code}" \
  "${_code_verifier}"
