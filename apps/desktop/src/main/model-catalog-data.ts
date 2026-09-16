import type { CatalogModel, CatalogVendor } from "@zen/shared";

import { ANTHROPIC_SEEDS, DEEPSEEK_SEEDS, GOOGLE_SEEDS } from "./model-catalog-west";
import {
  KIMI_SEEDS,
  META_SEEDS,
  MISTRAL_SEEDS,
  XAI_SEEDS,
} from "./model-catalog-more";
import { MIMO_SEEDS, QWEN_SEEDS, ZHIPU_SEEDS } from "./model-catalog-cn";
import { OPENAI_SEEDS } from "./model-catalog-openai";
import type { CatalogSeed } from "./model-catalog-seed";

export const CATALOG_VENDORS: CatalogVendor[] = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "google", label: "Google" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "mimo", label: "MiMo" },
  { id: "zhipu", label: "智谱" },
  { id: "qwen", label: "通义千问" },
  { id: "moonshot", label: "Moonshot / Kimi" },
  { id: "mistral", label: "Mistral" },
  { id: "meta", label: "Meta" },
  { id: "xai", label: "xAI" },
  { id: "other", label: "其他" },
];

const SEEDS: CatalogSeed[] = [
  ...OPENAI_SEEDS,
  ...ANTHROPIC_SEEDS,
  ...GOOGLE_SEEDS,
  ...DEEPSEEK_SEEDS,
  ...MIMO_SEEDS,
  ...ZHIPU_SEEDS,
  ...QWEN_SEEDS,
  ...KIMI_SEEDS,
  ...MISTRAL_SEEDS,
  ...META_SEEDS,
  ...XAI_SEEDS,
];

const VENDOR_LABEL = new Map(CATALOG_VENDORS.map((item) => [item.id, item.label]));

export function buildCatalogModels(): CatalogModel[] {
  return SEEDS.map((seed) => ({
    vendor: seed.vendorId,
    vendorLabel: VENDOR_LABEL.get(seed.vendorId) ?? seed.vendorId,
    modelKey: seed.modelKey,
    id: seed.id,
    name: seed.name,
    capabilities: seed.capabilities,
  }));
}
