import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

/**
 * Raw shape of a model object returned by Nexus Router's
 * `GET /models?show_all=true` endpoint.
 */
export interface NexusModel {
  id: string;
  modality?: string;
  labels?: string[];
  recipe?: string | null;
  downloaded?: boolean;
}

/**
 * A model is chat-capable if it is an Omni collection bundle
 * (`recipe === "collection.omni"`) or a plain text model
 * (`modality === "text"`). Image / STT / TTS models are excluded.
 */
export function isChatCapable(m: NexusModel): boolean {
  if (m.recipe === "collection.omni") return true;
  return m.modality === "text";
}

/**
 * Map a raw Nexus model to a pi ProviderModelConfig.
 *
 * All Nexus chat models probed reason (emit `reasoning_content`), so
 * `reasoning` is always true and we use the `qwen` thinkingFormat, which
 * makes pi send the top-level `enable_thinking` boolean and parse
 * `reasoning_content` deltas into the thinking block.
 *
 * Cost is zeroed: Nexus meters usage server-side against the subscription,
 * so pi must not double-count.
 *
 * The `/models` endpoint exposes no per-model context window or max-tokens
 * metadata, so we use safe defaults. maxTokens is generous (16384) because
 * reasoning models emit a thinking trace before the answer and truncate
 * badly if the budget is too small.
 */
export function toProviderModel(m: NexusModel): ProviderModelConfig {
  return {
    id: m.id,
    name: m.id,
    reasoning: true,
    input: ["text"],
    api: "openai-completions",
    contextWindow: 131072,
    maxTokens: 16384,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    compat: { thinkingFormat: "qwen" },
  };
}

/**
 * Filter the raw catalog to downloaded, chat-capable models and map each
 * to a ProviderModelConfig. Does NOT probe liveness — the factory does that.
 */
export function mapNexusModels(models: NexusModel[]): ProviderModelConfig[] {
  return models
    .filter((m) => m.downloaded === true && isChatCapable(m))
    .map(toProviderModel);
}
