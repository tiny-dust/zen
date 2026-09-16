import { caps, EFF_STD, MEDIA, REASON, TOOL, VISION } from "./model-catalog-seed";

import type { CatalogSeed } from "./model-catalog-seed";

export const KIMI_SEEDS: CatalogSeed[] = [
  {
    vendorId: "moonshot",
    vendor: "moonshot",
    modelKey: "kimi-k3",
    id: "kimi-k3",
    name: "Kimi K3",
    capabilities: caps({
      ...REASON,
      ...VISION,
      ...TOOL,
      ...MEDIA,
      contextWindow: 1_000_000,
      maxOutputTokens: 65_536,
      reasoningEfforts: ["low", "high", "max"],
    }),
  },
  {
    vendorId: "moonshot",
    vendor: "moonshot",
    modelKey: "kimi-k2.7-code",
    id: "kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    capabilities: caps({
      ...REASON,
      ...VISION,
      ...TOOL,
      contextWindow: 256_000,
      maxOutputTokens: 64_000,
      reasoningEfforts: [...EFF_STD],
    }),
  },
  {
    vendorId: "moonshot",
    vendor: "moonshot",
    modelKey: "kimi-k2.7-code-highspeed",
    id: "kimi-k2.7-code-highspeed",
    name: "Kimi K2.7 Code Highspeed",
    capabilities: caps({
      ...VISION,
      ...TOOL,
      contextWindow: 256_000,
      maxOutputTokens: 64_000,
    }),
  },
  {
    vendorId: "moonshot",
    vendor: "moonshot",
    modelKey: "kimi-k2.6",
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    capabilities: caps({
      ...REASON,
      ...VISION,
      ...TOOL,
      contextWindow: 256_000,
      maxOutputTokens: 64_000,
      reasoningEfforts: [...EFF_STD],
    }),
  },
  {
    vendorId: "moonshot",
    vendor: "moonshot",
    modelKey: "kimi-k2-0905-preview",
    id: "kimi-k2-0905-preview",
    name: "Kimi K2",
    capabilities: caps({ ...TOOL, contextWindow: 131_072, maxOutputTokens: 16_384 }),
  },
];

export const MISTRAL_SEEDS: CatalogSeed[] = [
  {
    vendorId: "mistral",
    vendor: "mistral",
    modelKey: "mistral-large-latest",
    id: "mistral-large-latest",
    name: "Mistral Large",
    capabilities: caps({ ...TOOL, contextWindow: 128_000, maxOutputTokens: 8_192 }),
  },
  {
    vendorId: "mistral",
    vendor: "mistral",
    modelKey: "mistral-medium-latest",
    id: "mistral-medium-latest",
    name: "Mistral Medium",
    capabilities: caps({ ...TOOL, contextWindow: 128_000, maxOutputTokens: 8_192 }),
  },
  {
    vendorId: "mistral",
    vendor: "mistral",
    modelKey: "codestral-latest",
    id: "codestral-latest",
    name: "Codestral",
    capabilities: caps({ ...TOOL, contextWindow: 256_000, maxOutputTokens: 32_768 }),
  },
];

export const META_SEEDS: CatalogSeed[] = [
  {
    vendorId: "meta",
    vendor: "meta",
    modelKey: "llama-4-maverick",
    id: "llama-4-maverick",
    name: "Llama 4 Maverick",
    capabilities: caps({
      ...VISION,
      ...TOOL,
      contextWindow: 1_000_000,
      maxOutputTokens: 8_192,
    }),
  },
  {
    vendorId: "meta",
    vendor: "meta",
    modelKey: "llama-4-scout",
    id: "llama-4-scout",
    name: "Llama 4 Scout",
    capabilities: caps({
      ...VISION,
      ...TOOL,
      contextWindow: 10_000_000,
      maxOutputTokens: 8_192,
    }),
  },
];

export const XAI_SEEDS: CatalogSeed[] = [
  {
    vendorId: "xai",
    vendor: "xai",
    modelKey: "grok-4.6",
    id: "grok-4.6",
    name: "Grok 4.6",
    capabilities: caps({
      ...REASON,
      ...VISION,
      ...TOOL,
      contextWindow: 500_000,
      maxOutputTokens: 64_000,
      reasoningEfforts: [...EFF_STD],
    }),
  },
  {
    vendorId: "xai",
    vendor: "xai",
    modelKey: "grok-4.5",
    id: "grok-4.5",
    name: "Grok 4.5",
    capabilities: caps({
      ...REASON,
      ...VISION,
      ...TOOL,
      contextWindow: 500_000,
      maxOutputTokens: 64_000,
      reasoningEfforts: [...EFF_STD],
    }),
  },
  {
    vendorId: "xai",
    vendor: "xai",
    modelKey: "grok-4.3",
    id: "grok-4.3",
    name: "Grok 4.3",
    capabilities: caps({
      ...REASON,
      ...VISION,
      ...TOOL,
      contextWindow: 1_000_000,
      maxOutputTokens: 64_000,
      reasoningEfforts: [...EFF_STD],
    }),
  },
  {
    vendorId: "xai",
    vendor: "xai",
    modelKey: "grok-build-0.1",
    id: "grok-build-0.1",
    name: "Grok Build",
    capabilities: caps({
      ...REASON,
      ...TOOL,
      contextWindow: 256_000,
      maxOutputTokens: 32_000,
      reasoningEfforts: [...EFF_STD],
    }),
  },
];
