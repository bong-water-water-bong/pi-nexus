# pi-nexus

[Nexus Router](https://nexus-projects.ai) provider for [pi](https://pi.dev) —
private, OpenAI-compatible inference through Geramy Loveless's Nexus Router
gateway. Models are discovered live at startup so your catalog is always
current, and each is probed so only models with a healthy backend are
registered.

## Features

- **Dynamic model discovery** — fetches the catalog from `GET /models?show_all=true` on every startup
- **Liveness probing** — each candidate gets a tiny chat call; models with no healthy backend (or embedding-only models) are skipped
- **Reasoning support** — uses pi's `qwen` thinking format, which sends the top-level `enable_thinking` flag and streams `reasoning_content` into pi's thinking block
- **Cost attribution** — every request carries `X-Nexus-Agent: pi` so usage rolls up correctly on your Nexus dashboard
- **Two auth paths** — environment variable or `auth.json`

## Quick Start

### 1. Get your Nexus token

Sign in at <https://nexus-projects.ai/dashboard> and copy your API token
(format `nxr_...`). Your account token is also your inference credential.

### 2. Authenticate (pick one)

```bash
# Option A: Environment variable
export NEXUS_API_KEY="nxr_..."

# Option B: auth.json (add a "nexus" entry)
# ~/.pi/agent/auth.json
{
  "nexus": { "type": "api_key", "key": "nxr_..." }
}
```

### 3. Install

```bash
# from a local checkout
pi install ./pi-nexus

# or from git
pi install git:github.com/bong-water-water-bong/pi-nexus

# or from npm
pi install npm:pi-nexus
```

### 4. Use it

```bash
pi
/model nexus            # pick from the discovered models
```

Or non-interactively:

```bash
pi --print --model "nexus/Qwen3.6-35B-A3B-MTP-GGUF" "hello"
```

## How it works

At startup the extension:

1. Resolves your API key from `$NEXUS_API_KEY` or the `nexus` entry in `~/.pi/agent/auth.json`.
2. Fetches `GET /models?show_all=true` from `https://api.nexus-projects.ai/api/v1`.
3. Filters to **downloaded** models that are **chat-capable** (`modality:"text"` or `recipe:"collection.omni"`).
4. Probes each with a minimal non-streaming chat call and keeps only the ones that return HTTP 2xx — this drops models with no healthy backend (e.g. `LMX-Omni-5.5B-Lite`) and embedding-only models (e.g. `Qwen3-Embedding-0.6B-GGUF`).
5. Registers the survivors under the `nexus` provider using pi's built-in `openai-completions` API.

No custom streaming code is required: the Router's `enable_thinking` boolean
and `reasoning_content` delta streaming are an exact match for pi's built-in
`qwen` thinking format.

## Configuration

| Env var | Default | Purpose |
|---------|---------|---------|
| `NEXUS_API_KEY` | — | API token (also read from `auth.json`) |
| `NEXUS_AGENT` | `pi` | Value of the `X-Nexus-Agent` cost-attribution header (≤128 chars) |

## Notes & caveats

- **Keep thinking on.** The Nexus reasoning models emit a `reasoning_content`
  trace even when `enable_thinking:false`, and truncate badly if the output
  budget is too small. pi's default `maxTokens` for these models is set to a
  generous 16384 so reasoning doesn't eat the whole budget before the answer.
  Keep your thinking level at `medium`/`high` for best results.
- **Cost is zeroed in pi.** Nexus meters usage server-side against your
  subscription, so pi reports zero cost locally to avoid double-counting. Check
  real usage on your dashboard.
- **Over-quota never hard-fails.** The Router paces (throttles) output instead
  of erroring, so pi just sees slower streaming when you go over.
- **Text-only.** All models are registered as text-only for now; vision support
  can be added if a model is confirmed vision-capable.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `no API key found` at startup | Set `NEXUS_API_KEY` or add a `nexus` entry to `~/.pi/agent/auth.json` |
| No nexus models in `/model` | Check your token is valid (`curl -H "Authorization: Bearer $NEXUS_API_KEY" https://api.nexus-projects.ai/api/v1/account`) |
| `probe failed / no healthy backend` | That model has no live backend right now; it's skipped. Try another. |
| Empty answers / `finish_reason: length` | Raise the thinking level and ensure the model isn't being starved of output tokens |

## Requirements

- **pi** `>= 0.80.0`
- A Nexus Projects account with an API token

## License

MIT
