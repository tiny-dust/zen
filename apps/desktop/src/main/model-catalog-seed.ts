import type { ModelCapabilities, ReasoningEffort } from "@zen/shared";

export type CatalogSeed = {
  vendorId: string;
  vendor: string;
  modelKey: string;
  id: string;
  name: string;
  capabilities: ModelCapabilities;
};

export function caps(partial: ModelCapabilities): ModelCapabilities {
  return { source: "catalog", ...partial };
}

export const REASON: Pick<ModelCapabilities, "reasoning"> = { reasoning: true };
export const TOOL: Pick<ModelCapabilities, "toolCall"> = { toolCall: true };
export const VISION: Pick<ModelCapabilities, "vision"> = { vision: true };
export const MEDIA: Pick<ModelCapabilities, "media"> = { media: true };
export const EFF_ALL: ReasoningEffort[] = ["low", "medium", "high", "xhigh", "max"];
export const EFF_STD: ReasoningEffort[] = ["low", "medium", "high"];
