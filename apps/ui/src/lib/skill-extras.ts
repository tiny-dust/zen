import type { SkillFileInfo } from "@zen/shared";

/**
 * 技能目录「额外内容」归类：判断技能是否带看板页 / 统计数据 / 脚本 / 文档，
 * 供聊天输入框上方的技能 tag 渲染独特标记与数量角标。
 * 纯函数：只看路径字符串，不读文件系统。
 */

export type SkillExtraKind = "dashboard" | "data" | "script" | "doc";

export interface SkillExtraGroup {
  kind: SkillExtraKind;
  files: SkillFileInfo[];
}

export interface SkillExtras {
  /** 非空分组，固定顺序 dashboard > data > script > doc */
  groups: SkillExtraGroup[];
  /** 存在 dashboard 或 data 组：tag 需要独特标记 */
  hasExtras: boolean;
  /** dashboard + data 组的文件总数（tag 角标与 title 用） */
  extraCount: number;
}

/** 分组固定展示顺序 */
const KIND_ORDER: SkillExtraKind[] = ["dashboard", "data", "script", "doc"];

/** 文件名（去扩展名）命中这些词的算看板 */
const DASHBOARD_STEMS = ["dashboard", "stats", "statistic", "metrics", "report"];

const DASHBOARD_EXTS = new Set(["html", "htm"]);

/** 数据文件扩展名（注意 .ts 属脚本，不在此列） */
const DATA_EXTS = new Set(["json", "jsonl", "csv", "tsv", "yml", "yaml", "toml"]);

const SCRIPT_EXTS = new Set(["js", "mjs", "cjs", "ts", "py", "sh", "bash", "zsh", "rb"]);

/** 拆 posix 相对路径：basename / 扩展名 / 去扩展名 stem，全部小写 */
function parsePath(path: string): { base: string; ext: string; stem: string } {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  const base = normalized.slice(normalized.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  // dot === 0 是 dotfile（如 ".env"），按无扩展名处理
  const hasExt = dot > 0;
  return {
    base,
    ext: hasExt ? base.slice(dot + 1) : "",
    stem: hasExt ? base.slice(0, dot) : base,
  };
}

/** 单个文件的归类；返回 null 表示不参与分组（SKILL.md 本身） */
function classifyFile(path: string): SkillExtraKind | null {
  const { base, ext, stem } = parsePath(path);
  if (base === "skill.md") {
    return null;
  }
  if (DASHBOARD_EXTS.has(ext) || DASHBOARD_STEMS.some((hint) => stem.includes(hint))) {
    return "dashboard";
  }
  if (DATA_EXTS.has(ext)) {
    return "data";
  }
  if (SCRIPT_EXTS.has(ext)) {
    return "script";
  }
  return "doc";
}

export function classifySkillFiles(files: SkillFileInfo[]): SkillExtras {
  const buckets = new Map<SkillExtraKind, SkillFileInfo[]>();
  for (const file of files) {
    const kind = classifyFile(file.path);
    if (!kind) {
      continue;
    }
    const bucket = buckets.get(kind);
    if (bucket) {
      bucket.push(file);
    } else {
      buckets.set(kind, [file]);
    }
  }

  const groups: SkillExtraGroup[] = [];
  for (const kind of KIND_ORDER) {
    const groupFiles = buckets.get(kind);
    if (groupFiles?.length) {
      groups.push({ kind, files: groupFiles });
    }
  }

  const extraCount = groups
    .filter((group) => group.kind === "dashboard" || group.kind === "data")
    .reduce((total, group) => total + group.files.length, 0);

  return { groups, hasExtras: extraCount > 0, extraCount };
}
