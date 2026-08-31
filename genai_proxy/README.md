# Local GenAI Proxy

`genai-proxy` is a minimal locally run Athenz resource proxy in front of a configured OpenAI-compatible gateway. It preserves the request path, method, query, body, response status, headers, and streaming response body, including the `/v1/responses` API.

The proxy verifies each Athenz Bearer access token with the local ZTS public key. The signed `aud` claim must identify one `gen-ai.services.<project>` project, the signed `sub` must identify a human user, `client_id` must identify the calling workload, and the token must grant the `gen-ai-users` scope. It never logs or stores the AT. Before forwarding a request, it replaces the Athenz `Authorization` header with the configured upstream credential from `OPENAI_CODEX_API_KEY`.

Successful generation responses are metered using the token counts reported by the upstream API and grouped by JST date, signed project, and user claims. Both Chat Completions `prompt_tokens`/`completion_tokens` and Responses API `input_tokens`/`output_tokens` are supported. Each daily entry includes the most recent usage time in JST using `HH:mm:ss` format. With `make local`, counters are stored in the gitignored `components/athenzd/.athenzd/genai-proxy-data/usage.json` file and survive container restarts.

Before forwarding a metered generation request, the proxy totals the service code's recorded spend for the current JST day. Athenz has a `$240` daily limit and Spire has a `$0.002` daily limit. Once a limit is reached, later generation requests return `429 Too Many Requests` with a `Retry-After` header and are not forwarded upstream. The upstream reports tokens only after a response completes, so the request that crosses a limit completes; enforcement begins with the next request. Limits reset at `00:00 JST`.

## Run locally

Set the upstream URL in the gitignored `genai_proxy/.env.local`, export its API key, and make sure the local Athenz distribution provides the ZTS public key at `athenz_dist/keys/zts.public.pem`:

```sh
printf 'GENAI_UPSTREAM_BASE_URL=https://gateway.example.com/v1\n' > genai_proxy/.env.local
export OPENAI_CODEX_API_KEY='<upstream API key>'
make genai
```

The parent context workspace provides the `make genai` convenience target. In a standalone `id-jag-the-hard-way` checkout, run `make -C genai_proxy local` instead. Both commands build `genai-proxy:local` and start it as the detached `genai-proxy-local` Docker container. The key is passed from the invoking environment into the running container; it is not stored in the image. Runtime logs are not attached to the terminal. The local `components/athenzd/.athenzd/genai-proxy-data` directory is mounted into the container for persistent usage data.

If that container already exists, `make local` asks before deleting and replacing it. Press Enter or answer `Y` to replace it; answer `n` to keep it and cancel the command.

The proxy listens on `0.0.0.0` so clients running in local Docker or kind containers can reach it through `host.docker.internal`. It uses the repository port allocation:

```sh
./tools/port.sh genai-proxy
# 64443
```

The service binds to every host interface for local container access. Run it only on a trusted development machine and do not expose port `64443` to the internet.

Override the port or locally configured upstream when needed:

```sh
make -C genai_proxy local PORT=65000 GENAI_UPSTREAM_BASE_URL=https://example.test/v1
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

## Connect Codex

The recommended flow uses the directory-level `athenzd-genai-proxy` client-side injector daemon. Add `gen_ai.proxy` to the project's `.athenzd/config.yaml` and run `athenzd login` from that directory. The manager ensures the separate daemon is healthy and then exits. Point Codex at the injector rather than directly at the upstream gateway:

```toml
[model_providers.local-genai]
name = "Local GenAI through Athenz"
base_url = "http://127.0.0.1:65443/v1"
env_key = "OPENAI_CODEX_API_KEY"
wire_api = "responses"
```

The injector reloads the active `athenzd` cache on each request and replaces the client credential with the active Athenz AT. The protected proxy validates that AT, attributes usage to its project and user claims, and replaces it with `OPENAI_CODEX_API_KEY` only for the upstream request.

For direct troubleshooting without the injector, connect to `http://host.docker.internal:64443`, select Bearer auth, and paste the raw active AT into API Key.

## Call the Responses API with the active `athenzd` AT

The example below reads the cached token without printing it, calls the OpenAI-compatible models endpoint through the proxy, and then clears the shell variable:

```sh
_athenz_at="$(jq -r '.access_token.token' ~/.cache/athenzd/idjag-learner.json)"
_genai_proxy_port="$(./tools/port.sh genai-proxy)"

curl --fail --silent --show-error \
  -H "Authorization: Bearer ${_athenz_at}" \
  "http://127.0.0.1:${_genai_proxy_port}/v1/models" | jq

unset _athenz_at _genai_proxy_port
```

## Read user project usage

`GET /api/users/{user}` is an unauthenticated local reporting endpoint. Pass the username without its stored `user.` subject prefix; for example, `idjag-learner` reads data stored for `user.idjag-learner`. It returns only that user's daily counters grouped by signed project, ordered by newest JST date and `last_usage` time. An unknown user returns `{ "projects": [] }`.

```sh
_genai_proxy_port="$(./tools/port.sh genai-proxy)"

curl --fail --silent --show-error \
  "http://127.0.0.1:${_genai_proxy_port}/api/users/idjag-learner" | jq

unset _genai_proxy_port
```

Example response:

```json
{
  "projects": [
    {
      "project": "athenz",
      "scope": "gen-ai.services.athenz:role.gen-ai-users",
      "daily_limit_usd": 240,
      "daily_limit_fraction_digits": 2,
      "daily_spend_usd": 0.0000072,
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
          "estimated_cost_usd": 0.0000072,
          "tokens": [
            {
              "model": "gpt-5.6-luna",
              "requests": 1,
              "input": 12,
              "output": 20,
              "total": 32,
              "estimated_cost_usd": 0.0000072
            }
          ]
        }
      ]
    }
  ]
}
```

These are model-usage tokens reported by the configured upstream, not Athenz access tokens. Each project includes its proxy-enforced daily limit, configured display precision, and current project-wide JST spend. Each daily user entry and model includes proxy-calculated estimated cost, so reporting clients do not need their own pricing table. GPT-5.6 Sol, Terra, and Luna use OpenAI's standard API prices from the [official pricing page](https://developers.openai.com/api/docs/pricing); an unregistered model ID uses the default `$0.10` input and `$0.30` output price per million tokens. An uncapped project returns `null` for its limit fields. The proxy stores no prompts, generated content, or credentials. Because this endpoint intentionally has no authentication, keep port `64443` limited to the trusted local development environment.

For a small non-streaming Responses API request, replace `<model-id>` with an ID returned by `/v1/models`:

```sh
_athenz_at="$(jq -r '.access_token.token' ~/.cache/athenzd/idjag-learner.json)"
_genai_proxy_port="$(./tools/port.sh genai-proxy)"

curl --fail --silent --show-error \
  -H "Authorization: Bearer ${_athenz_at}" \
  -H "Content-Type: application/json" \
  --data '{"model":"<model-id>","input":"Say hello in one sentence.","stream":false}' \
  "http://127.0.0.1:${_genai_proxy_port}/v1/responses" | jq

unset _athenz_at _genai_proxy_port
```

## Validate

```sh
make -C genai_proxy check
make -C genai_proxy test
```
