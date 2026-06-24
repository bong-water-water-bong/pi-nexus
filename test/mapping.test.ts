import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isChatCapable,
  toProviderModel,
  mapNexusModels,
} from "../lib/mapping.ts";

test("text modality is chat-capable", () => {
  assert.equal(isChatCapable({ id: "q", modality: "text", downloaded: true }), true);
});

test("image/stt/tts are not chat-capable", () => {
  assert.equal(isChatCapable({ id: "f", modality: "image", downloaded: true }), false);
  assert.equal(isChatCapable({ id: "w", modality: "stt", downloaded: true }), false);
  assert.equal(isChatCapable({ id: "k", modality: "tts", downloaded: true }), false);
});

test("collection.omni is chat-capable regardless of modality", () => {
  assert.equal(isChatCapable({ id: "o", recipe: "collection.omni", downloaded: true }), true);
  assert.equal(isChatCapable({ id: "o2", recipe: "collection.omni", modality: "image", downloaded: true }), true);
});

test("mapNexusModels drops non-downloaded", () => {
  const out = mapNexusModels([{ id: "a", modality: "text", downloaded: false }]);
  assert.equal(out.length, 0);
});

test("mapNexusModels drops non-chat (image) even if downloaded", () => {
  const out = mapNexusModels([{ id: "img", modality: "image", downloaded: true }]);
  assert.equal(out.length, 0);
});

test("toProviderModel sets all required fields", () => {
  const m = toProviderModel({ id: "Qwen3.6-35B-A3B-MTP-GGUF", modality: "text", downloaded: true });
  assert.equal(m.id, "Qwen3.6-35B-A3B-MTP-GGUF");
  assert.equal(m.name, "Qwen3.6-35B-A3B-MTP-GGUF");
  assert.equal(m.reasoning, true);
  assert.deepEqual(m.input, ["text"]);
  assert.equal(m.api, "openai-completions");
  assert.equal(m.contextWindow, 131072);
  assert.equal(m.maxTokens, 16384);
  assert.deepEqual(m.cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.equal(m.compat?.thinkingFormat, "qwen");
});

test("mapNexusModels end-to-end on a realistic catalog", () => {
  const catalog = [
    { id: "Flux-2-Klein-9B-GGUF", modality: "image", labels: ["image"], downloaded: true },
    { id: "Qwen3.6-35B-A3B-MTP-GGUF", modality: "text", labels: ["text"], downloaded: true },
    { id: "Whisper-Large-v3-Turbo", modality: "stt", labels: ["stt"], downloaded: true },
    { id: "kokoro-v1", modality: "tts", labels: ["tts"], downloaded: true },
    { id: "Nemotron-3-Nano-30B-A3B-Nexus-Agents-GGUF-Q4_K_M", modality: "text", labels: ["text"], downloaded: true },
    { id: "LMX-Omni-52B-Halo", recipe: "collection.omni", downloaded: true },
    { id: "NXS-PJX-Interview", recipe: "collection.omni", downloaded: true },
    { id: "NXS-PJX-Discovery", recipe: "collection.omni", downloaded: true },
    { id: "SD-Turbo", modality: "image", labels: ["image"], downloaded: false },
    { id: "LMX-Omni-5.5B-Lite", recipe: "collection.omni", downloaded: false },
  ];
  // 5 chat-capable downloaded models. LMX-Omni-5.5B-Lite is excluded because
  // it is not downloaded here; the factory's live probe is what removes a
  // downloaded-but-backend-less model like it from the final list.
  const out = mapNexusModels(catalog);
  assert.equal(out.length, 5);
  assert.deepEqual(out.map((m) => m.id), [
    "Qwen3.6-35B-A3B-MTP-GGUF",
    "Nemotron-3-Nano-30B-A3B-Nexus-Agents-GGUF-Q4_K_M",
    "LMX-Omni-52B-Halo",
    "NXS-PJX-Interview",
    "NXS-PJX-Discovery",
  ]);
});
