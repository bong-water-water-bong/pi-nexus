/**
 * pi-nexus — Nexus Router provider for pi
 *
 * Registers the Nexus Router (https://api.nexus-projects.ai) as an
 * OpenAI-compatible model provider. The Router meters usage against the
 * account's Stripe subscription and never hard-blocks over-quota usage
 * (it paces output instead).
 *
 * Auth via env var or auth.json:
 *   export NEXUS_API_KEY=nxr_...            # env var
 *   /login nexus (future)                   # interactive (not yet)
 *   "nexus": {"type":"api_key","key":"nxr_..."}  # auth.json
 *
 * At startup this extension:
 *   1. Fetches /models?show_all=true.
 *   2. Filters to downloaded, chat-capable models (text or collection.omni).
 *   3. Probes each with a tiny chat call and skips any that don't serve text
 *      (e.g. a model with no healthy backend).
 *   4. Registers the survivors under the "nexus" provider.
 *
 * No custom streaming is needed: pi's built-in openai-completions API with the
 * `qwen` thinkingFormat is an exact match for the Router's `enable_thinking`
 * boolean + `reasoning_content` delta streaming.
 */

import type {
  ExtensionAPI,
  ProviderModelConfig,
} from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { mapNexusModels, type NexusModel } from "../lib/mapping.ts";

const BASE_URL = "https://api.nexus-projects.ai/api/v1";
const PROVIDER_NAME = "nexus";
const ENV_API_KEY = "NEXUS_API_KEY";
const ENV_AGENT = "NEXUS_AGENT";

/**
 * Resolve the Nexus API key for startup model discovery.
 *
 * The extension factory runs before pi's auth storage is available to it, so
 * it can only see process.env and the filesystem. We try, in order:
 *   1. $NEXUS_API_KEY env var
 *   2. the "nexus" entry in ~/.pi/agent/auth.json (same store pi reads at
 *      request time, so auth.json works for discovery too)
 *
 * At request time pi resolves the key itself from the provider config's
 * `apiKey: "$NEXUS_API_KEY"` plus the same auth.json entry.
 */
function resolveApiKey(): string | undefined {
  const envKey = process.env[ENV_API_KEY];
  if (envKey && envKey.trim()) return envKey;
  try {
    const authPath = join(homedir(), ".pi", "agent", "auth.json");
    const raw = readFileSync(authPath, "utf-8");
    const data = JSON.parse(raw) as Record<string, unknown>;
    const cred = data[PROVIDER_NAME];
    if (
      cred &&
      typeof cred === "object" &&
      cred !== null &&
      (cred as { type?: string }).type === "api_key" &&
      typeof (cred as { key?: string }).key === "string"
    ) {
      return (cred as { key: string }).key;
    }
  } catch {
    // auth.json missing/unreadable — fine, env var is the other path.
  }
  return undefined;
}

export default async function (pi: ExtensionAPI) {
  const apiKey = resolveApiKey();

  if (!apiKey) {
    console.warn(
      `[pi-nexus] no API key found. Skipping model discovery.\n` +
        `  Auth options:\n` +
        `    export ${ENV_API_KEY}=nxr_...                # env var\n` +
        `    "nexus": {"type":"api_key","key":"nxr_..."}  # ~/.pi/agent/auth.json`
    );
    return;
  }

  // 1. Discover models.
  let models: NexusModel[];
  try {
    const res = await fetch(`${BASE_URL}/models?show_all=true`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }
    const data = (await res.json()) as
      | { data?: NexusModel[] }
      | NexusModel[];
    models = Array.isArray(data) ? data : data.data ?? [];
  } catch (err) {
    console.warn(
      `[pi-nexus] model discovery failed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return;
  }

  // 2. Filter to downloaded, chat-capable candidates.
  const candidates = mapNexusModels(models);
  if (candidates.length === 0) {
    console.warn("[pi-nexus] no downloaded chat-capable models found.");
    return;
  }

  // 3. Probe each candidate; keep only those that actually serve text.
  const verified: ProviderModelConfig[] = [];
  for (const m of candidates) {
    const ok = await probeModel(m.id, apiKey);
    if (ok) {
      verified.push(m);
    } else {
      console.warn(
        `[pi-nexus] skipping "${m.id}" (probe failed / no healthy backend)`
      );
    }
  }

  if (verified.length === 0) {
    console.warn("[pi-nexus] no models passed probe; not registering provider.");
    return;
  }

  // 4. Register. Provider-level X-Nexus-Agent header is merged into every
  //    request for server-side cost attribution. Override via NEXUS_AGENT.
  const agent = (process.env[ENV_AGENT] || "pi").slice(0, 128);

  pi.registerProvider(PROVIDER_NAME, {
    name: "Nexus Router",
    baseUrl: BASE_URL,
    apiKey: `$${ENV_API_KEY}`,
    api: "openai-completions",
    headers: { "X-Nexus-Agent": agent },
    models: verified,
  });

  console.log(
    `[pi-nexus] registered ${verified.length} models under "${PROVIDER_NAME}".`
  );
}

/**
 * Minimal non-streaming chat call to confirm a model has a healthy backend.
 * Returns true on HTTP 2xx, false otherwise. Cheap and one-time at startup.
 */
async function probeModel(id: string, apiKey: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Nexus-Agent": "pi-probe",
      },
      body: JSON.stringify({
        model: id,
        messages: [{ role: "user", content: "Reply with exactly: pong" }],
        stream: false,
        max_completion_tokens: 64,
        enable_thinking: false,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
