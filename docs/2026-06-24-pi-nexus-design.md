# pi-nexus — Nexus Router provider for pi

**Date:** 2026-06-24
**Status:** Approved (design)
**Owner:** bong-water-water-bong

## Goal

Create a publishable pi package (`pi-nexus`) that registers the **Nexus Router**
(`https://api.nexus-projects.ai`) as a model provider in pi, so its chat models
can be used as the coding agent's backend. Authenticated with the user's
`nxr_...` account token. Structured to publish to npm/GitHub exactly like the
existing `pi-tokenrouter` package.

## Background — what Nexus Router is

Nexus Router is Geramy Loveless's private, OpenAI-compatible inference gateway
(C#/.NET, "Lemonade" inference surface). It meters usage per Stripe billing
period and never hard-blocks over-quota (it paces output instead). Source of
truth for the protocol: the `NEXUS_SUBSCRIPTION_API.md` and
`NEXUS_DEVICE_TOKEN_SPEC.md` specs in `Geramy/nexus-project-client`, plus live
probes documented below.

### Verified protocol (probed against production, 2026-06-24)

- **Base URL:** `https://api.nexus-projects.ai/api/v1` (note `/api/v1`, not `/v1`).
- **Auth:** `Authorization: Bearer <nxr_token>` on every call. The account
  bearer token IS the inference credential (no separate inference key).
- **Cost attribution header:** `X-Nexus-Agent: <label>` (≤128 chars). Omitting
  it rolls cost up as `"(unattributed)"` in `/usage/agents`.
- **Session affinity header:** `X-Nexus-Session: <id>` (≤128 chars) pins a
  conversation to one warm backend. Optional.
- **Chat:** `POST /chat/completions`, OpenAI-compatible. SSE stream when
  `stream:true`, terminated by `data: [DONE]`. Uses **`max_completion_tokens`**
  (not `max_tokens`).
- **Thinking:** top-level **`enable_thinking: true|false`** boolean. Reasoning
  arrives as **`reasoning_content`** deltas, separate from `content`. Confirmed
  the server still emits reasoning even when `enable_thinking:false` on the
  Qwen/Nemotron/Omni models probed — so reasoning models must be run with
  thinking ON and a generous token budget, or they truncate before emitting
  content.
- **Models:** `GET /models?show_all=true` →
  `{object:"list", data:[{id, object, created, owned_by, modality, labels, downloaded, recipe, composite_models?}]}`.
  `modality` ∈ `text|image|stt|tts`. `recipe:"collection.omni"` marks a
  multi-model bundle.
- **Account/usage/billing:** `/account`, `/usage`, `/plans`, `/billing/*` —
  standard, snake_case JSON. The user's account is Pro, Active, 6M tokens,
  5 concurrent agents.

### Verified live model behavior (downloaded=true models, non-streaming + streaming)

| Model | chat works? | reasoning? | notes |
|-------|-------------|-----------|-------|
| `Qwen3.6-35B-A3B-MTP-GGUF` | ✅ | ✅ (`reasoning_content`) | text; streams reasoning then content |
| `Nemotron-3-Nano-30B-A3B-Nexus-Agents-GGUF-Q4_K_M` | ✅ | ✅ | agent-tuned text |
| `LMX-Omni-52B-Halo` | ✅ | ✅ | `collection.omni` |
| `NXS-PJX-Interview` | ✅ | ✅ | `collection.omni` |
| `NXS-PJX-Discovery` | ✅ | ✅ | `collection.omni` |
| `LMX-Omni-5.5B-Lite` | ❌ `no_backend_available` | — | **skip** (no healthy text backend) |

Vision (image input) probes were inconclusive (empty content / backend errors),
so all models are registered **text-only** for now.

## Design

### Package layout (mirrors `pi-tokenrouter`)

```
pi-nexus/
├── package.json              # "pi-package", pi.extensions = ["./extensions"]
├── extensions/
│   └── nexus.ts              # the provider registration extension
├── README.md
├── LICENSE                   # MIT
├── .gitignore                # node_modules, dist, *.log
└── docs/
    └── 2026-06-24-pi-nexus-design.md   # this file
```

### The extension (`extensions/nexus.ts`)

An **async factory** (so models are discovered before pi finishes startup, and
show up in `/model` and `pi --list-models`):

1. Resolve the API key: `process.env.NEXUS_API_KEY`, else an `auth.json`
   `"nexus"` entry (pi checks auth storage first, then the provider's
   `apiKey` config value — both supported). If neither, warn and return (same
   graceful skip as tokenrouter).
2. `GET /models?show_all=true` with `Authorization: Bearer <token>`.
3. Filter to **downloaded === true** AND chat-capable
   (`modality === "text"` OR `recipe === "collection.omni"`).
4. **Probe each candidate** with a tiny non-streaming chat call
   (`max_completion_tokens: 64`, `enable_thinking:false`) and **skip any that
   error** (e.g. `no_backend_available`). This prevents registering dead
   models. Probing is cheap and one-time at startup.
5. Map survivors to `ProviderModelConfig[]`:
   - `id`, `name` (= id), `reasoning: true` (all probed survivors reason),
     `input: ["text"]` (vision not confirmed).
   - `compat: { thinkingFormat: "qwen" }` so pi sends top-level
     `enable_thinking` and reads `reasoning_content`. (`max_completion_tokens`
     is pi's default field already — no `maxTokensField` override needed.)
   - `contextWindow: 131072`, `maxTokens: 16384` (safe defaults; the server
     gives no per-model metadata and reasoning needs headroom).
   - `cost: { input:0, output:0, cacheRead:0, cacheWrite:0 }` — Nexus meters
     server-side; pi must not double-count.
6. `pi.registerProvider("nexus", { name:"Nexus Router", baseUrl, apiKey:
   "$NEXUS_API_KEY", api:"openai-completions", headers: {"X-Nexus-Agent":
   <env or "pi">}, models })`.

### Auth (approved approach: A — token in auth.json + env)

- Env var: `NEXUS_API_KEY`.
- `auth.json`: `"nexus": { "type":"api_key", "key":"nxr_..." }`.
- `/login nexus` interactive email/password flow is **out of scope** for v1
  (follow-up). The env/auth.json path is identical to the user's existing
  `deepseek`/`zai`/`openrouter`/`openai-codex` providers and needs no code.

### Models registered (approved: all downloaded chat models)

All downloaded chat-capable models that pass the startup probe. As of the probe:
`Qwen3.6-35B-A3B-MTP-GGUF`, `Nemotron-3-Nano-30B-A3B-Nexus-Agents-GGUF-Q4_K_M`,
`LMX-Omni-52B-Halo`, `NXS-PJX-Interview`, `NXS-PJX-Discovery`. Catalog refreshes
on every pi startup.

### How it maps onto pi's built-in openai-completions (no custom streaming)

- `qwen` thinkingFormat → `params.enable_thinking = !!reasoningEffort`
  (verified in `pi-ai/.../openai-completions.js`). When pi's thinking level is
  "off", `reasoningEffort` is `undefined` → `enable_thinking:false`. ⚠️ Because
  Nexus models still emit reasoning even with `enable_thinking:false`, users
  should keep thinking **on** for these models (default in the user's settings
  is already `"high"`).
- `reasoning_content` deltas are parsed by pi's existing `reasoningFields`
  array (`["reasoning_content","reasoning","reasoning_text"]`) into the thinking
  block. No custom `streamSimple` needed.
- `model.headers` + provider `headers` are merged by `model-registry.js` into
  every request → `X-Nexus-Agent` reaches every call automatically.
- The OpenAI SDK sends `Authorization: Bearer <apiKey>` from the resolved key,
  so the `nxr_` token works with no `authHeader` flag.

### Error handling

- No special overflow handling needed: Nexus uses standard OpenAI error
  envelopes; pi's built-in openai-completions error mapping handles them.
- Startup fetch/probe failures are caught and logged with `console.warn`;
  the extension returns without registering (pi keeps running, like tokenrouter).
- Over-quota throttling: Nexus paces rather than errors, so pi just sees slower
  streaming — no special handling required.

## Testing / verification plan

1. `pi --list-models` shows the nexus models after setting `NEXUS_API_KEY`.
2. Load the extension in a real pi session (`pi install ./pi-nexus` or add to
   `settings.json` packages) and run a chat turn against a nexus model —
   reasoning streams into the thinking block, answer into content.
3. Confirm usage increments on the Nexus dashboard (`/usage`).

## Out of scope (follow-ups)

- `/login nexus` interactive email/password OAuth flow.
- Image generation, TTS, STT endpoints (pi doesn't consume these).
- Vision input (revisit if a model is confirmed vision-capable).
- Exposing account/usage/billing as pi commands.
