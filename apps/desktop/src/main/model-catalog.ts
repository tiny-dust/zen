import type { CatalogMatch, CatalogModel } from "@zen/shared";

import { buildCatalogModels, CATALOG_VENDORS } from "./model-catalog-data";
import { fetchRemoteCatalogModels } from "./model-catalog-remote";
import { getDb } from "./model-db-connection";

/** 内存目录缓存：DB 为空时兜底使用静态种子 */
let memoryCatalog: CatalogModel[] | null = null;
/** DB 目录缓存：刷新后失效重读，避免每次列表都查库 */
let dbCatalog: CatalogModel[] | null = null;

function getSeeds(): CatalogModel[] {
  if (!memoryCatalog) {
    memoryCatalog = buildCatalogModels();
  }
  return memoryCatalog;
}

function loadDbCatalog(): CatalogModel[] {
  if (dbCatalog) {
    return dbCatalog;
  }
  const rows = getDb()
    .prepare(
      `SELECT model_key, vendor, vendor_label, model_id, display_name, capabilities_json
       FROM catalog_models`,
    )
    .all() as Array<{
    model_key: string;
    vendor: string;
    vendor_label: string;
    model_id: string;
    display_name: string;
    capabilities_json: string;
  }>;
  dbCatalog = rows.map((row) => {
    let capabilities: CatalogModel["capabilities"] = { source: "catalog" };
    try {
      capabilities = JSON.parse(row.capabilities_json) as CatalogModel["capabilities"];
    } catch {
      // 能力 JSON 损坏时保留兜底，不让单条脏数据炸掉整个目录
    }
    return {
      vendor: row.vendor,
      vendorLabel: row.vendor_label,
      modelKey: row.model_key,
      id: row.model_id,
      name: row.display_name,
      capabilities,
    };
  });
  return dbCatalog;
}

/** 生效目录：用户点过「更新」后为 DB 快照（实时数据源），否则回退内置种子 */
function getEffectiveCatalog(): CatalogModel[] {
  const rows = loadDbCatalog();
  return rows.length ? rows : getSeeds();
}

export function getMemoryCatalog(): CatalogModel[] {
  return getEffectiveCatalog();
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
  const catalog = getEffectiveCatalog();
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
  const catalog = getEffectiveCatalog();
  if (!vendor || vendor === "all") {
    return catalog;
  }
  return catalog.filter((item) => item.vendor === vendor);
}

export interface CatalogRefreshResult {
  count: number;
  updatedAt: number;
}

/**
 * 一键实时更新：拉取 models.dev 目录并整表替换落库。
 * 替换语义保证已下架/已移除的条目不再出现；空结果不落库，保留当前目录。
 */
export async function refreshCatalogFromRemote(): Promise<CatalogRefreshResult> {
  const { models, fetchedAt } = await fetchRemoteCatalogModels();
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO catalog_models
      (model_key, vendor, vendor_label, model_id, display_name, capabilities_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
    db.prepare(`DELETE FROM catalog_models`).run();
    for (const model of models) {
      insert.run(
        model.modelKey,
        model.vendor,
        model.vendorLabel,
        model.id,
        model.name,
        JSON.stringify(model.capabilities),
        fetchedAt,
      );
    }
  })();
  dbCatalog = null;
  return { count: models.length, updatedAt: fetchedAt };
}

/** 目录最近一次更新时间（种子写入或实时刷新取较新者）；0 表示从未写入 */
export function getCatalogUpdatedAt(): number {
  const row = getDb()
    .prepare(`SELECT MAX(updated_at) AS updated_at FROM catalog_models`)
    .get() as { updated_at: number | null };
  return row.updated_at ?? 0;
}

/** 空库时写入内置种子；用户刷新后的 DB 快照不在启动时被覆盖 */
export function seedCatalogIfEmpty(models: CatalogModel[] = getSeeds()): void {
  const db = getDb();
  const count = db.prepare(`SELECT COUNT(*) AS count FROM catalog_models`).get() as { count: number };
  if (count.count > 0) {
    return;
  }
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO catalog_models
      (model_key, vendor, vendor_label, model_id, display_name, capabilities_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  db.transaction(() => {
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
  })();
  dbCatalog = null;
}
