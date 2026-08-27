# @webface/dsh-desk-models

The webfaCe Desk model layer as a profile bundle. Its substance is
`cordis.patch.yml`; the package exports no runtime API.

## What it patches

| Row | Effect |
|---|---|
| `llm-pi-ai` | Declares the `openrouter` route (`OPENROUTER_API_KEY`, `https://openrouter.ai/api/v1`) with DeepSeek, GLM, Kimi, Qwen, Anthropic and OpenAI models, and the optional `sovereign` private-gateway route. |
| `agent-default-model` | `openrouter` / `deepseek/deepseek-v4-pro`. |
| `session-telemetry-otel` | `mode: DISABLED` as a literal. No environment variable can re-enable the upstream exporter. |

## Use

Add the bundle after `@deepseek-ai/dsh-base` (and `@deepseek-ai/dsh-web-app`)
in a profile's `dsh.profile.bundles`, and store the key with the Models page or
`OPENROUTER_API_KEY` in `$DSH_HOME/.credentials.yaml`.

## Limitations

- Context windows are pinned to 262144 for every model; raise per model when a
  job needs more.
- The `sovereign` route needs `SOVEREIGN_GATEWAY_KEY` and reachability to the
  gateway; it is declared for every Desk and only fails when selected.
