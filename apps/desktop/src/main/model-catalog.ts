import type { CatalogMatch, CatalogModel } from "@zen/shared";

import { buildCatalogModels, CATALOG_VENDORS } from "./model-catalog-data";
import { getDb } from "./model-db-connection";

let memoryCatalog: CatalogModel[] | null = null;

export function getMemoryCatalog(): CatalogModel[] {
  if (!memoryCatalog) {
    memoryCatalog = buildCatalogModels();
  }
  return memoryCatalog;
}

export function listCatalogVendors() {
  return CATALOG_VENDORS;
}

/**
 * 拆分自定义 model id 为匹配候选。
 * 例：`VW2TTQCH/deepseek-v4-flash` → [`VW2TTQCH/deepseek-v4-flash`, `deepseek-v4-flash`, `deepseek-v4`]
 */
export function splitModelIdCandidates(modelId: string): string[] {
  const raw = modelId.trim().toLowerCase();
  if (!raw) {
    return [];
  }
  const candidates = new Set<string>();
  candidates.add(raw);

  const slashParts = raw.split("/").filter(Boolean);
  const last = slashParts[slashParts.length - 1] ?? raw;
  if (slashParts.length > 1) {
    candidates.add(last);
    // org/model 形式再补 org-model
    if (slashParts.length === 2) {
      candidates.add(slashParts.join("-"));
    }
  }

  // 去掉日期后缀 / 版本点后缀
  const stripped = last
    .replace(/[-_]?\d{8}$/, "")
    .replace(/[-_]?\d{4}-\d{2}-\d{2}$/, "")
    .replace(/[-_]?(preview|latest|beta|alpha)$/i, "");
  if (stripped && stripped !== last) {
    candidates.add(stripped);
  }

  // 前缀 token 再截一段：deepseek-v4-flash → deepseek-v4
  const tokens = stripped.split(/[-_.]/).filter(Boolean);
  if (tokens.length >= 3) {
    candidates.add(tokens.slice(0, 2).join("-"));
  }
  const firstToken = tokens[0];
  if (firstToken) {
    candidates.add(firstToken);
  }

  return [...candidates];
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function scoreMatch(candidate: string, model: CatalogModel): number {
  const key = normalizeKey(model.modelKey);
  const id = normalizeKey(model.id);
  if (candidate === key) {
    return 100;
  }
  if (candidate === id) {
    return 95;
  }
  if (key.startsWith(candidate) || candidate.startsWith(key)) {
    return 70 + Math.min(10, Math.abs(key.length - candidate.length));
  }
  if (id.includes(candidate) && candidate.length >= 6) {
    return 50;
  }
  return 0;
}

export function matchCatalogModel(modelId: string): CatalogMatch {
  const candidates = splitModelIdCandidates(modelId);
  const catalog = getMemoryCatalog();
  let best: CatalogModel | null = null;
  let bestScore = 0;

  for (const candidate of candidates) {
    for (const model of catalog) {
      const score = scoreMatch(candidate, model);
      if (score > bestScore) {
        bestScore = score;
        best = model;
      }
    }
  }

  return {
    model: bestScore >= 50 ? best : null,
    candidates,
  };
}

export function listCatalogModels(vendor?: string): CatalogModel[] {
  const catalog = getMemoryCatalog();
  if (!vendor || vendor === "all") {
    return catalog;
  }
  return catalog.filter((item) => item.vendor === vendor);
}

/** 启动时 upsert 目录，保证官方模型更新能同步到本地 SQLite */
export function seedCatalogIfEmpty(models: CatalogModel[] = getMemoryCatalog()): void {
  const now = Date.now();
  const stmt = getDb().prepare(
    `INSERT INTO catalog_models
      (model_key, vendor, vendor_label, model_id, display_name, capabilities_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(model_key) DO UPDATE SET
       vendor = excluded.vendor,
       vendor_label = excluded.vendor_label,
       model_id = excluded.model_id,
       display_name = excluded.display_name,
       capabilities_json = excluded.capabilities_json,
       updated_at = excluded.updated_at`,
  );
  const tx = getDb().transaction(() => {
    for (const model of models) {
      stmt.run(
        model.modelKey,
        model.vendor,
        model.vendorLabel,
        model.id,
        model.name,
        JSON.stringify(model.capabilities),
        now,
      );
    }
  });
  tx();
}
