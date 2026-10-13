import { ipcRenderer } from "electron";

import type { FeatureCatalogResult } from "@zen/shared";

/** 可选功能目录：目录 + probe 结果（feature:list） */
export const featureApi = {
  features: {
    list(): Promise<FeatureCatalogResult> {
      return ipcRenderer.invoke("feature:list");
    },
  },
};
