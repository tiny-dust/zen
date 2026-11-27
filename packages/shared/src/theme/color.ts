/** 颜色工具：只做主题推导需要的最小集合（sRGB ⇄ OKLab、WCAG 对比度） */

export type RGB = [number, number, number];
type Lab = [number, number, number];

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX.test(value);
}

export function parseHex(hex: string): RGB | null {
  if (!isHexColor(hex)) {
    return null;
  }
  let body = hex.slice(1);
  if (body.length === 3) {
    body = [...body].map((c) => c + c).join("");
  }
  return [0, 2, 4].map((i) => Number.parseInt(body.slice(i, i + 2), 16)) as RGB;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function toHex([r, g, b]: RGB): string {
  return `#${[r, g, b]
    .map((v) =>
      Math.round(clamp(v, 0, 255))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

function rgbToLab(rgb: RGB): Lab {
  const [r, g, b] = rgb.map(toLinear) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function labToLinear([L, a, b]: Lab): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (lin: RGB) => lin.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

/** 超出色域时降彩度，保持亮度与色相 */
function lchToRgb(L: number, C: number, H: number): RGB {
  let c = C;
  for (let i = 0; i < 24; i++) {
    const lin = labToLinear([L, c * Math.cos(H), c * Math.sin(H)]);
    if (inGamut(lin) || c < 1e-4) {
      return lin.map((v) => fromLinear(clamp(v, 0, 1))) as RGB;
    }
    c *= 0.85;
  }
  return labToLinear([L, 0, 0]).map((v) => fromLinear(clamp(v, 0, 1))) as RGB;
}

function toLch(hex: string): [number, number, number] {
  const [L, a, b] = rgbToLab(parseHex(hex) ?? [0, 0, 0]);
  return [L, Math.hypot(a, b), Math.atan2(b, a)];
}

/** 在 OKLCH 里改亮度（dL 为 OKLab 的 L，0–1 区间） */
export function shiftLightness(hex: string, dL: number): string {
  const [L, C, H] = toLch(hex);
  return toHex(lchToRgb(clamp(L + dL, 0, 1), C, H));
}

/** OKLab 混色：t=0 → a，t=1 → b */
export function mixColor(a: string, b: string, t: number): string {
  const la = rgbToLab(parseHex(a) ?? [0, 0, 0]);
  const lb = rgbToLab(parseHex(b) ?? [0, 0, 0]);
  const lin = labToLinear([0, 1, 2].map((i) => (la[i] ?? 0) + ((lb[i] ?? 0) - (la[i] ?? 0)) * t) as Lab);
  return toHex(lin.map((v) => fromLinear(clamp(v, 0, 1))) as RGB);
}

export function luminance(hex: string): number {
  const [r, g, b] = (parseHex(hex) ?? [0, 0, 0]).map(toLinear) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** 把 fg 的亮度往远离背景的方向推，直到与每个背景都不低于 min；推到头仍不够则返回最接近的 */
export function ensureContrast(fg: string, bgs: string[], min: number): string {
  const ok = (c: string) => bgs.every((bg) => contrastRatio(c, bg) >= min);
  if (ok(fg)) {
    return fg;
  }
  const avg = bgs.reduce((sum, bg) => sum + luminance(bg), 0) / bgs.length;
  const step = avg > 0.18 ? -0.01 : 0.01;
  let c = fg;
  for (let i = 0; i < 100 && !ok(c); i++) {
    c = shiftLightness(c, step);
  }
  return c;
}
