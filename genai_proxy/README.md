# Local GenAI Proxy

`genai-proxy` is a minimal locally run proxy in front of Ollama. It preserves the native Ollama request path, method, query, body, response status, headers, and streaming response body, so both `/api/*` and Ollama's OpenAI-compatible `/v1/*` APIs work through it.

The proxy verifies each Athenz Bearer access token with the local ZTS public key. The signed `aud` claim must identify one `gen-ai.services.<project>` project, the signed `sub` must identify a human user, `client_id` must identify the calling workload, and the token must grant the `gen-ai-users` scope. It never logs or stores the AT and removes the `Authorization` header before forwarding to Ollama.

Successful generation responses are metered using the token counts reported by Ollama and grouped by JST date, signed project, and user claims. Each daily entry includes the most recent usage time in JST using `HH:mm:ss` format. With `make local`, counters are stored in the gitignored `athenzd/.athenzd/genai-proxy-data/usage.json` file and survive container restarts.

## Run locally

Ollama must already be listening on its default API address, `http://127.0.0.1:11434`. The local Athenz distribution must provide the ZTS public key at `athenz_dist/keys/zts.public.pem`.

```sh
make -C genai_proxy local
```

This builds `genai-proxy:local` and starts it as the detached `genai-proxy-local` Docker container. Runtime logs are not attached to the terminal. The local `athenzd/.athenzd/genai-proxy-data` directory is mounted into the container for persistent usage data.

If that container already exists, `make local` asks before deleting and replacing it. Press Enter or answer `Y` to replace it; answer `n` to keep it and cancel the command.

The proxy listens on `0.0.0.0` so clients running in local Docker or kind containers can reach it through `host.docker.internal`. It uses the repository port allocation:

```sh
./tools/port.sh genai-proxy
# 64443
```

The service binds to every host interface for local container access. Run it only on a trusted development machine and do not expose port `64443` to the internet.

Override either endpoint when needed:

```sh
make -C genai_proxy local PORT=65000 OLLAMA_BASE_URL=http://host.docker.internal:11434
```

Override the ZTS public key when needed:

```sh
make -C genai_proxy local ATHENZ_PUBLIC_KEY_PATH=/path/to/zts.public.pem
```

Override the persistent data directory when needed:

```sh
make -C genai_proxy local DATA_DIR=/path/to/genai-proxy-data
```

To restrict the proxy to host-only clients instead, override the bind address:

```sh
make -C genai_proxy local HOST=127.0.0.1
```

Stop the detached proxy with:

```sh
docker stop genai-proxy-local
```

## Connect Open WebUI

The recommended flow uses the directory-level `athenzd-genai-proxy` client-side injector daemon. Add `gen_ai.proxy` to the project's `.athenzd/config.yaml` and run `athenzd login` from that directory. The manager ensures the separate daemon is healthy and then exits. Add an external Ollama connection in Open WebUI with these values:

- URL: `http://host.docker.internal:65443`
- Auth: disabled
- Prefix ID: empty
- Model IDs: empty
- Tags: optional

The injector reloads the active `athenzd` cache on each request and sends the AT to this protected proxy. Open WebUI does not need to store the credential.

For direct troubleshooting without the injector, connect to `http://host.docker.internal:64443`, select Bearer auth, and paste the raw active AT into API Key.

## Call Ollama with the active `athenzd` AT

The example below reads the cached token without printing it, calls Ollama's native tags endpoint through the proxy, and then clears the shell variable:

```sh
_athenz_at="$(jq -r '.access_token.token' ~/.cache/athenzd/idjag-learner.json)"
_genai_proxy_port="$(./tools/port.sh genai-proxy)"

curl --fail --silent --show-error \
  -H "Authorization: Bearer ${_athenz_at}" \
  "http://127.0.0.1:${_genai_proxy_port}/api/tags" | jq

unset _athenz_at _genai_proxy_port
```

## Read project usage

`GET /api/users` is an unauthenticated local reporting endpoint. It returns daily stored counters grouped by the signed project, ordered by newest JST date and `last_usage` time:

```sh
_genai_proxy_port="$(./tools/port.sh genai-proxy)"

curl --fail --silent --show-error \
  "http://127.0.0.1:${_genai_proxy_port}/api/users" | jq

unset _genai_proxy_port
```

Example response:

```json
{
  "projects": [
    {
      "project": "athenz",
      "scope": "gen-ai.services.athenz:role.gen-ai-users",
      "users": [
        {
          "date": "2026-07-20",
          "last_usage": "21:34:56",
          "sub": "user.idjag-learner",
          "client_id": "home.idjag-learner.local.athenzd",
          "scope": "gen-ai.services.athenz:role.gen-ai-users",
          "requests": 1,
          "input_tokens": 12,
          "output_tokens": 20,
          "total_tokens": 32,
          "tokens": [
            {
              "model": "gemma4:26b",
              "requests": 1,
              "input": 12,
              "output": 20,
              "total": 32
            }
          ]
        }
      ]
    }
  ]
}
```

These are model-usage tokens reported by Ollama, not Athenz access tokens. Each daily user entry includes per-model totals so dashboards can display `gemma4:26b` now and additional models independently when they are used. The proxy stores no prompts, generated content, or credentials. Because this endpoint intentionally has no authentication, keep port `64443` limited to the trusted local development environment.

For a small non-streaming Gemma request:

```sh
_athenz_at="$(jq -r '.access_token.token' ~/.cache/athenzd/idjag-learner.json)"
_genai_proxy_port="$(./tools/port.sh genai-proxy)"

curl --fail --silent --show-error \
  -H "Authorization: Bearer ${_athenz_at}" \
  -H "Content-Type: application/json" \
  --data '{"model":"gemma4:26b","messages":[{"role":"user","content":"Say hello in one sentence."}],"stream":false}' \
  "http://127.0.0.1:${_genai_proxy_port}/api/chat" | jq

unset _athenz_at _genai_proxy_port
```

## Validate

```sh
make -C genai_proxy check
make -C genai_proxy test
```
