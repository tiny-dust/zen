import { ensureContrast, isHexColor, mixColor, parseHex, shiftLightness, toHex } from "./color";

import type { RGB } from "./color";

/**
 * 自定义主题 / 主题包（兼容 nomi 的 .nomitheme.json 与 .nomitheme ZIP）。
 * 只保存种子色与白名单 token 覆盖；派生结果由 deriveZenTokens 算出来，
 * 导入的文件不会被拼成 CSS 文本，只当颜色值写进 CSS 变量。
 */

export const SEED_KEYS = ["accent", "background", "surface", "text"] as const;
export type SeedKey = (typeof SEED_KEYS)[number];
export type ThemeBase = "light" | "dark";
export type Seeds = Partial<Record<SeedKey, string>>;

export const CUSTOM_THEME_FORMAT = 2;
export const CUSTOM_THEME_PREFIX = "custom:";
export const MAX_CUSTOM_THEMES = 50;
/** 单个主题定义上限（够放 40 个 token 覆盖） */
export const MAX_CUSTOM_THEME_BYTES = 64 * 1024;
export const MAX_THEME_PACK_BYTES = 8 * 1024 * 1024;
export const MAX_THEME_BACKGROUND_BYTES = 12 * 1024 * 1024;

export interface CustomThemeBackground {
  /** theme-images 目录下的文件名（与图片主题同一受控通道） */
  id: string;
  blur: number;
  dim: number;
}

export interface CustomThemeVariant {
  seeds: Seeds;
  tokens?: Record<string, string>;
}

export interface CustomTheme {
  id: string;
  /** 按语言命名，至少一个非空 */
  name: Record<string, string>;
  base: ThemeBase;
  seeds: Seeds;
  tokens?: Record<string, string>;
  /** 与 base 相反的那一套：有值就跟随系统切换 */
  variants?: Partial<Record<ThemeBase, CustomThemeVariant>>;
  background?: CustomThemeBackground;
}

/** 主题包内容 = 主题定义去掉 id */
export type CustomThemePack = Omit<CustomTheme, "id">;

/** Zen 允许被主题覆盖的 CSS 变量白名单：其它名字一律忽略，避免污染布局变量 */
export const ZEN_THEME_TOKENS = [
  "--color-bg",
  "--color-panel",
  "--color-main-bg",
  "--color-side",
  "--color-side-glass",
  "--color-side-hover",
  "--color-side-active",
  "--color-side-sel",
  "--color-side-item",
  "--color-side-chip",
  "--color-side-chip-active",
  "--color-popover",
  "--color-set-card",
  "--color-settings-card",
  "--color-settings-nav",
  "--color-line",
  "--color-line-soft",
  "--color-line-warm",
  "--color-line-strong",
  "--color-txt",
  "--color-txt-strong",
  "--color-mut",
  "--color-dim",
  "--color-icon",
  "--color-topbar-icon",
  "--color-menu-hover",
  "--color-menu-active",
  "--color-input-bg",
  "--color-composer-surface",
  "--color-composer-fg",
  "--color-composer-placeholder",
  "--color-code-bg",
  "--color-accent",
  "--term-bg",
  "--term-fg",
] as const;

export type ZenThemeToken = (typeof ZEN_THEME_TOKENS)[number];
const TOKEN_SET: ReadonlySet<string> = new Set(ZEN_THEME_TOKENS);

export const isZenThemeToken = (name: string): name is ZenThemeToken => TOKEN_SET.has(name);

const HEX_ANY = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FN = /^(?:rgba?|hsla?|oklch)\(\s*[0-9.,%\s/+-]+\)$/i;

/** 只认颜色写法：拦下 url( / var( / 分号 / 花括号等可用于注入的内容 */
export function isSafeColorValue(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && (HEX_ANY.test(value) || COLOR_FN.test(value));
}

export const otherBase = (base: ThemeBase): ThemeBase => (base === "dark" ? "light" : "dark");

export const BASE_SEEDS: Record<ThemeBase, Record<SeedKey, string>> = {
  light: { accent: "#b64b16", background: "#faf9f6", surface: "#ffffff", text: "#211d19" },
  dark: { accent: "#ff6a2b", background: "#13161b", surface: "#1b1f25", text: "#f7f9fc" },
};

const CUSTOM_ID = /^[a-z0-9]{4,32}$/;

export const isCustomThemeId = (value: unknown): value is string =>
  typeof value === "string" && CUSTOM_ID.test(value);

export const customThemeValue = (id: string) => `${CUSTOM_THEME_PREFIX}${id}`;

/** custom:<id> → id；不是自定义主题返回 null */
export function parseCustomThemeValue(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith(CUSTOM_THEME_PREFIX)) {
    return null;
  }
  const id = value.slice(CUSTOM_THEME_PREFIX.length);
  return isCustomThemeId(id) ? id : null;
}

const cleanText = (value: unknown, max: number): string => {
  if (typeof value !== "string") {
    return "";
  }
  // eslint-disable-next-line no-control-regex -- 去掉控制字符，避免名称里混入换行/ESC
  return value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
};

function normalizeSeeds(raw: unknown): Seeds {
  const out: Seeds = {};
  for (const key of SEED_KEYS) {
    const value = (raw as Record<string, unknown> | undefined)?.[key];
    if (isHexColor(value)) {
      out[key] = toHex(parseHex(value) ?? [0, 0, 0]);
    }
  }
  return out;
}

function normalizeTokens(raw: unknown): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries((raw as Record<string, unknown> | undefined) ?? {})) {
    if (isZenThemeToken(name) && isSafeColorValue(value)) {
      out[name] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

const finite = (value: unknown, lo: number, hi: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;

/** 背景图文件名白名单：与 theme-images 目录里的实际命名一致 */
export const isThemeImageFileId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-z0-9]{8,64}\.(png|jpg|jpeg|webp)$/i.test(value);

export function normalizeBackground(raw: unknown, validId: (id: string) => boolean): CustomThemeBackground | undefined {
  const value = raw as Partial<CustomThemeBackground> | null | undefined;
  if (!value || typeof value.id !== "string" || !validId(value.id)) {
    return undefined;
  }
  return {
    id: value.id,
    blur: Math.round(finite(value.blur, 0, 40, 0)),
    dim: Math.round(finite(value.dim, 0, 0.9, 0.45) * 100) / 100,
  };
}

/** 主题包 / 主题定义归一：非法字段丢弃，非法整体返回 null */
export function normalizeThemePack(
  raw: unknown,
  validBackgroundId: (id: string) => boolean = isThemeImageFileId,
): CustomThemePack | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const value = raw as Record<string, unknown>;
  const base = value.base === "dark" ? "dark" : value.base === "light" ? "light" : null;
  if (!base) {
    return null;
  }
  const name: Record<string, string> = {};
  if (typeof value.name === "string") {
    const text = cleanText(value.name, 40);
    if (text) {
      name.zh = text;
      name.en = text;
    }
  } else if (value.name && typeof value.name === "object") {
    for (const key of ["zh", "en"]) {
      const text = cleanText((value.name as Record<string, unknown>)[key], 40);
      if (text) {
        name[key] = text;
      }
    }
  }
  if (!name.zh && !name.en) {
    return null;
  }

  let variants: Partial<Record<ThemeBase, CustomThemeVariant>> | undefined;
  const rawVariants = value.variants as Record<string, unknown> | undefined;
  if (rawVariants && typeof rawVariants === "object") {
    const key = otherBase(base);
    const variant = rawVariants[key] as Record<string, unknown> | undefined;
    if (variant && typeof variant === "object") {
      variants = { [key]: { seeds: normalizeSeeds(variant.seeds), ...(normalizeTokens(variant.tokens) ? { tokens: normalizeTokens(variant.tokens) } : {}) } };
    }
  }

  const tokens = normalizeTokens(value.tokens);
  const background = normalizeBackground(value.background, validBackgroundId);
  return {
    name,
    base,
    seeds: normalizeSeeds(value.seeds),
    ...(tokens ? { tokens } : {}),
    ...(variants ? { variants } : {}),
    ...(background ? { background } : {}),
  };
}

export function normalizeCustomTheme(
  raw: unknown,
  validBackgroundId: (id: string) => boolean = isThemeImageFileId,
): CustomTheme | null {
  const id = (raw as { id?: unknown } | null | undefined)?.id;
  if (!isCustomThemeId(id)) {
    return null;
  }
  const pack = normalizeThemePack(raw, validBackgroundId);
  return pack ? { id, ...pack } : null;
}

/** 一套明暗用哪组种子：缺的从基底补 */
export function resolvedSeeds(
  def: Pick<CustomTheme, "base" | "seeds" | "variants">,
  base: ThemeBase = def.base,
): Record<SeedKey, string> {
  const variant = base !== def.base ? def.variants?.[base] : undefined;
  const source = variant?.seeds ?? def.seeds;
  const out = { ...BASE_SEEDS[base] };
  for (const key of SEED_KEYS) {
    const value = source[key];
    if (isHexColor(value)) {
      out[key] = toHex(parseHex(value) ?? [0, 0, 0]);
    }
  }
  return out;
}

/** 有另一套明暗 → 跟随系统 */
export const isAdaptiveTheme = (def: Pick<CustomTheme, "base" | "variants">): boolean =>
  Boolean(def.variants?.[otherBase(def.base)]);

export const resolveCustomBase = (def: Pick<CustomTheme, "base" | "variants">, systemDark: boolean): ThemeBase =>
  isAdaptiveTheme(def) ? (systemDark ? "dark" : "light") : def.base;

const rgbOver = (top: string, alpha: number, base: string): string => {
  const a = parseHex(top) ?? ([0, 0, 0] as RGB);
  const b = parseHex(base) ?? ([0, 0, 0] as RGB);
  return toHex([0, 1, 2].map((i) => (a[i] ?? 0) * alpha + (b[i] ?? 0) * (1 - alpha)) as RGB);
};

/**
 * 种子色 → Zen 的 CSS 变量。
 * 先定底色，再让文字对会落上去的每种底都达标（正文 4.5:1），避免用户选了浅底浅字后完全读不到。
 */
export function deriveZenTokens(
  def: Pick<CustomTheme, "base" | "seeds" | "variants" | "tokens">,
  base: ThemeBase = def.base,
): Record<string, string> {
  const { accent, background, surface, text } = resolvedSeeds(def, base);
  const dark = base === "dark";
  const towardText = (color: string, t: number) => mixColor(color, text, t);

  const side = dark ? mixColor(background, surface, 0.45) : mixColor(background, surface, 0.35);
  const sideHover = towardText(side, dark ? 0.06 : 0.05);
  const sideActive = towardText(side, dark ? 0.1 : 0.09);
  const popover = dark ? mixColor(surface, text, 0.04) : surface;
  const line = towardText(surface, dark ? 0.12 : 0.12);
  const grounds = [background, surface, side, popover];

  const brand = ensureContrast(accent, grounds, 3);
  const textSafe = ensureContrast(text, grounds, 4.5);
  const muted = ensureContrast(towardText(text, dark ? 0.25 : 0.3), grounds, 4.5);
  const dim = ensureContrast(towardText(text, dark ? 0.34 : 0.38), grounds, 4.5);

  const tokens: Record<string, string> = {
    "--color-bg": background,
    "--color-panel": surface,
    "--color-main-bg": popover,
    "--color-side": side,
    "--color-side-glass": side,
    "--color-side-hover": sideHover,
    "--color-side-active": sideActive,
    "--color-side-sel": sideActive,
    "--color-side-item": textSafe,
    "--color-side-chip": sideHover,
    "--color-side-chip-active": sideActive,
    "--color-popover": popover,
    "--color-set-card": surface,
    "--color-settings-card": popover,
    "--color-settings-nav": side,
    "--color-line": line,
    "--color-line-soft": rgbOver(text, dark ? 0.08 : 0.06, surface),
    "--color-line-warm": line,
    "--color-line-strong": towardText(surface, dark ? 0.2 : 0.22),
    "--color-txt": dark ? textSafe : rgbOver(text, 0.82, surface),
    "--color-txt-strong": textSafe,
    "--color-mut": muted,
    "--color-dim": dim,
    "--color-icon": muted,
    "--color-topbar-icon": dim,
    "--color-menu-hover": sideHover,
    "--color-menu-active": sideActive,
    "--color-input-bg": dark ? mixColor(background, surface, 0.4) : surface,
    "--color-composer-surface": popover,
    "--color-composer-fg": textSafe,
    "--color-composer-placeholder": muted,
    "--color-code-bg": dark ? mixColor(surface, text, 0.06) : mixColor(surface, background, 0.55),
    "--term-bg": dark ? side : surface,
    "--term-fg": dark ? textSafe : mixColor(text, surface, 0.15),
    "--color-accent": shiftLightness(brand, dark ? 0.03 : -0.02),
  };

  // 主题包里的覆盖：只认白名单与合法颜色
  const variantTokens = (base !== def.base ? def.variants?.[base]?.tokens : undefined) ?? def.tokens;
  for (const [name, value] of Object.entries(variantTokens ?? {})) {
    if (isZenThemeToken(name) && isSafeColorValue(value)) {
      tokens[name] = value;
    }
  }
  return tokens;
}

/** 预览色卡：背景 / 表面 / 文字 / 强调 */
export const customThemeSwatch = (
  def: Pick<CustomTheme, "base" | "seeds" | "variants">,
  base: ThemeBase = def.base,
): [string, string, string, string] => {
  const seeds = resolvedSeeds(def, base);
  return [seeds.background, seeds.surface, seeds.text, seeds.accent];
};

export function customThemeLabel(def: Pick<CustomTheme, "name">, locale: string): string {
  const name = def.name ?? {};
  const key = locale.startsWith("zh") ? "zh" : "en";
  return name[key] ?? name.en ?? name.zh ?? "";
}

export const themeToPack = (def: CustomTheme): CustomThemePack => {
  const { id: _id, ...pack } = def;
  return pack;
};

/** Zen token ↔ nomi token：导出时写成 nomi 的名字，导入时反查回 Zen 的名字 */
export const ZEN_TO_NOMI_TOKENS: Readonly<Record<string, string>> = {
  "--color-bg": "--cd-color-bg",
  "--color-panel": "--cd-color-surface",
  "--color-main-bg": "--cd-color-surface",
  "--color-side": "--cd-color-bg-subtle",
  "--color-side-glass": "--cd-color-bg-subtle",
  "--color-side-hover": "--cd-color-hover",
  "--color-side-active": "--cd-color-active",
  "--color-side-sel": "--cd-color-selected-bg",
  "--color-side-item": "--cd-color-text",
  "--color-line": "--cd-color-border",
  "--color-line-soft": "--cd-color-border-subtle",
  "--color-line-strong": "--cd-color-border-strong",
  "--color-txt": "--cd-color-text",
  "--color-txt-strong": "--cd-color-text",
  "--color-mut": "--cd-color-text-muted",
  "--color-dim": "--cd-color-text-subtle",
  "--color-icon": "--cd-color-text-muted",
  "--color-menu-hover": "--cd-color-hover",
  "--color-menu-active": "--cd-color-active",
  "--color-input-bg": "--cd-color-input-bg",
  "--color-composer-surface": "--cd-color-surface",
  "--color-composer-fg": "--cd-color-text",
  "--color-code-bg": "--cd-color-surface-sunken",
  "--color-accent": "--cd-color-accent",
  "--term-bg": "--cd-color-surface-sunken",
  "--term-fg": "--cd-color-text",
};

/**
 * 反向表必须显式写：多个 Zen 变量（panel / main-bg / composer-surface）共用同一个 nomi 名字，
 * 用 Object.fromEntries 反推只会剩下最后一个，导入时就会落到奇怪的变量上。
 */
const NOMI_TO_ZEN_TOKENS: Readonly<Record<string, string>> = {
  "--cd-color-bg": "--color-bg",
  "--cd-color-surface": "--color-panel",
  "--cd-color-bg-subtle": "--color-side",
  "--cd-color-hover": "--color-menu-hover",
  "--cd-color-active": "--color-menu-active",
  "--cd-color-selected-bg": "--color-side-sel",
  "--cd-color-text": "--color-txt-strong",
  "--cd-color-border": "--color-line",
  "--cd-color-border-subtle": "--color-line-soft",
  "--cd-color-border-strong": "--color-line-strong",
  "--cd-color-text-muted": "--color-mut",
  "--cd-color-text-subtle": "--color-dim",
  "--cd-color-input-bg": "--color-input-bg",
  "--cd-color-surface-sunken": "--color-code-bg",
  "--cd-color-accent": "--color-accent",
};

/** 导出用：Zen token 名换成 nomi 名（nomi 认得的才写出去） */
export function tokensToNomi(tokens: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!tokens) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) {
    const nomi = ZEN_TO_NOMI_TOKENS[name];
    if (nomi && isSafeColorValue(value)) {
      out[nomi] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/** 导入用：nomi 的 --cd-color-* 换回 Zen 的 --color-*；不认识的丢弃 */
export function tokensFromNomi(tokens: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!tokens) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(tokens)) {
    const zen = NOMI_TO_ZEN_TOKENS[name];
    if (zen && isSafeColorValue(value)) {
      out[zen] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * nomi 主题包 → Zen 字段：
 * - tokens / variants[].tokens 的 token 名换回 Zen；
 * - background.image（包内文件名）→ id 占位，blur 保留，opacity 映射成 dim（0–0.9 遮罩强度）。
 */
export function packFromNomi(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") {
    return raw;
  }
  const value = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { ...value };
  if (value.tokens && typeof value.tokens === "object") {
    out.tokens = tokensFromNomi(value.tokens as Record<string, string>);
  }
  if (value.variants && typeof value.variants === "object") {
    const variants: Record<string, unknown> = {};
    for (const [key, variant] of Object.entries(value.variants as Record<string, unknown>)) {
      const item = variant as Record<string, unknown> | null;
      if (item && typeof item === "object") {
        variants[key] = {
          ...item,
          ...(item.seeds ? { seeds: item.seeds } : {}),
          ...(item.tokens ? { tokens: tokensFromNomi(item.tokens as Record<string, string>) } : {}),
        };
      }
    }
    out.variants = variants;
  }
  const background = value.background as Record<string, unknown> | null | undefined;
  if (background && typeof background === "object" && typeof background.image === "string") {
    out.background = {
      id: background.image,
      blur: background.blur,
      dim: background.opacity,
    };
  }
  return out;
}

/** Zen 主题包 → nomi 字段（导出用）：token 名换成 --cd-*，背景字段改成 image / opacity */
export function packToNomi(pack: CustomThemePack, backgroundFile?: string): Record<string, unknown> {
  const variants: Record<string, unknown> = {};
  for (const [key, variant] of Object.entries(pack.variants ?? {})) {
    if (variant) {
      variants[key] = {
        seeds: variant.seeds,
        ...(tokensToNomi(variant.tokens) ? { tokens: tokensToNomi(variant.tokens) } : {}),
      };
    }
  }
  return {
    format: CUSTOM_THEME_FORMAT,
    name: pack.name,
    base: pack.base,
    seeds: pack.seeds,
    ...(tokensToNomi(pack.tokens) ? { tokens: tokensToNomi(pack.tokens) } : {}),
    ...(Object.keys(variants).length ? { variants } : {}),
    ...(pack.background && backgroundFile
      ? { background: { image: backgroundFile, blur: pack.background.blur, opacity: pack.background.dim } }
      : {}),
  };
}
