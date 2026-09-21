/**
 * 终端输出的 ANSI SGR 着色解析：把 `runTerminal` 工具结果里的
 * 颜色转义序列转成带样式的文本片段，消息流内与底部终端观感一致。
 *
 * 支持：SGR 0/1/2/3/4/7/9/22/23/24/29、30-37/90-97、40-47/100-107、
 * 38;5;n 与 48;5;n（256 色）、38;2;r;g;b 与 48;2;r;g;b（真彩色）。
 * 其余 CSI/OSC 序列（光标移动、标题设置等）与孤立 CR 一律剥除。
 */

/** 16 色板：xterm.js 默认 Tango 色，与底部终端面板一致 */
const PALETTE = [
  "#2e3436",
  "#cc0000",
  "#4e9a06",
  "#c4a000",
  "#3465a4",
  "#75507b",
  "#06989a",
  "#d3d7cf",
  "#555753",
  "#ef2929",
  "#8ae234",
  "#fce94f",
  "#729fcf",
  "#ad7fa8",
  "#34e2e2",
  "#eeeeec",
] as const;

const ESC = String.fromCharCode(27);

/** OSC 序列：ESC ] ... 终止于 BEL 或 ESC \ */
const OSC_RE = new RegExp(`${ESC}\\][^${String.fromCharCode(7)}${ESC}]*(?:${String.fromCharCode(7)}|${ESC}\\\\)`, "g");
/** 非 SGR 的 CSI 序列（光标移动/擦除等，末位不是 m） */
const CSI_OTHER_RE = new RegExp(`${ESC}\\[(?![0-9;]*m)[0-9;?]*[ -/]*[@-~]`, "g");
/** 其余两字符转义（ESC + 单字符） */
const ESC_CHAR_RE = new RegExp(`${ESC}[@-Z\\\\-_]`, "g");
/** 悬空的 ESC（后面不是 CSI 引导符） */
const ESC_STRAY_RE = new RegExp(`${ESC}(?!\\[)`, "g");
/** SGR 序列 */
const SGR_RE = new RegExp(`${ESC}\\[([0-9;]*)m`, "g");

export interface AnsiSpan {
  text: string;
  /** 布尔类修饰：粗体/暗淡/斜体/下划线/删除线 */
  cls?: string;
  /** 计算出的内联样式（color/background） */
  style?: string;
}

interface SgrState {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  inverse: boolean;
}

function initialState(): SgrState {
  return {
    fg: null,
    bg: null,
    bold: false,
    dim: false,
    italic: false,
    underline: false,
    strike: false,
    inverse: false,
  };
}

/** xterm.js 256 色编号 → hex（0-15 色板 / 16-231 6×6×6 立方 / 232-255 灰阶） */
function color256(index: number): string {
  if (index < 16) {
    return PALETTE[index] ?? "#d3d7cf";
  }
  if (index < 232) {
    const base = index - 16;
    const channel = (value: number) => (value === 0 ? 0 : 55 + value * 40);
    const r = channel(Math.floor(base / 36));
    const g = channel(Math.floor((base % 36) / 6));
    const b = channel(base % 6);
    return `#${[r, g, b].map((part) => part.toString(16).padStart(2, "0")).join("")}`;
  }
  const gray = 8 + (index - 232) * 10;
  const hex = gray.toString(16).padStart(2, "0");
  return `#${hex}${hex}${hex}`;
}

/** 处理一段 SGR 参数，原地更新状态 */
function applySgr(state: SgrState, params: string): void {
  const codes = params.length
    ? params.split(";").map((part) => {
        const value = Number.parseInt(part, 10);
        return Number.isFinite(value) ? value : 0;
      })
    : [0];

  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i] ?? 0;
    if (code === 0) {
      Object.assign(state, initialState());
    } else if (code === 1) {
      state.bold = true;
    } else if (code === 2) {
      state.dim = true;
    } else if (code === 3) {
      state.italic = true;
    } else if (code === 4) {
      state.underline = true;
    } else if (code === 7) {
      state.inverse = true;
    } else if (code === 9) {
      state.strike = true;
    } else if (code === 22) {
      state.bold = false;
      state.dim = false;
    } else if (code === 23) {
      state.italic = false;
    } else if (code === 24) {
      state.underline = false;
    } else if (code === 27) {
      state.inverse = false;
    } else if (code === 29) {
      state.strike = false;
    } else if (code === 39) {
      state.fg = null;
    } else if (code === 49) {
      state.bg = null;
    } else if (code >= 30 && code <= 37) {
      state.fg = PALETTE[code - 30] ?? null;
    } else if (code >= 90 && code <= 97) {
      state.fg = PALETTE[code - 90 + 8] ?? null;
    } else if (code >= 40 && code <= 47) {
      state.bg = PALETTE[code - 40] ?? null;
    } else if (code >= 100 && code <= 107) {
      state.bg = PALETTE[code - 100 + 8] ?? null;
    } else if ((code === 38 || code === 48) && i + 1 < codes.length) {
      const mode = codes[i + 1];
      if (mode === 5 && i + 2 < codes.length) {
        const color = color256(codes[i + 2] ?? 0);
        if (code === 38) state.fg = color;
        else state.bg = color;
        i += 2;
      } else if (mode === 2 && i + 4 < codes.length) {
        const rgb = [codes[i + 2], codes[i + 3], codes[i + 4]]
          .map((part) => Math.max(0, Math.min(255, part ?? 0)))
          .join(",");
        const color = `rgb(${rgb})`;
        if (code === 38) state.fg = color;
        else state.bg = color;
        i += 4;
      }
    }
  }
}

function styleOf(state: SgrState): { cls?: string; style?: string } {
  const cls: string[] = [];
  if (state.bold) cls.push("ansi-b");
  if (state.dim) cls.push("ansi-dim");
  if (state.italic) cls.push("ansi-i");
  if (state.underline) cls.push("ansi-u");
  if (state.strike) cls.push("ansi-strike");

  const declarations: string[] = [];
  // 反显 = 前景/背景互换；默认色互换落到代码区块自带的 fg/bg 上
  if (state.inverse) {
    declarations.push(`background:${state.fg ?? "var(--color-code-fg)"}`);
    declarations.push(`color:${state.bg ?? "var(--color-code-bg)"}`);
  } else {
    if (state.fg) declarations.push(`color:${state.fg}`);
    if (state.bg) declarations.push(`background:${state.bg}`);
  }

  return {
    cls: cls.length ? cls.join(" ") : undefined,
    style: declarations.length ? declarations.join(";") : undefined,
  };
}

/** 输出是否携带 ANSI 转义（无转义时可走纯文本快路径） */
export function hasAnsi(text: string): boolean {
  return text.includes(ESC);
}

/** 剥除全部 ANSI 转义与控制字符，得到纯文本（复制/搜索用） */
export function stripAnsi(text: string): string {
  return text
    .replace(OSC_RE, "")
    .replace(new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g"), "")
    .replace(ESC_CHAR_RE, "")
    .replace(ESC_STRAY_RE, "");
}

/** 剥除非 SGR 转义（保留 SGR 序列交给主循环解析） */
function stripAnsiKeepSgr(text: string): string {
  return text.replace(OSC_RE, "").replace(CSI_OTHER_RE, "").replace(ESC_CHAR_RE, "").replace(ESC_STRAY_RE, "");
}

/** 把终端文本解析成样式片段；无样式段落合并为单段 */
export function ansiToSpans(text: string): AnsiSpan[] {
  // CRLF → LF；剩余孤立 CR（进度条刷新帧）剥掉，避免重复帧堆叠
  const clean = stripAnsiKeepSgr(text.replace(/\r\n/g, "\n").replace(/\r/g, ""));
  const spans: AnsiSpan[] = [];
  const state = initialState();
  let cursor = 0;
  let match: RegExpExecArray | null;

  const push = (raw: string) => {
    if (!raw) {
      return;
    }
    const last = spans.at(-1);
    const { cls, style } = styleOf(state);
    if (last && last.cls === cls && last.style === style) {
      last.text += raw;
      return;
    }
    spans.push(style || cls ? { text: raw, cls, style } : { text: raw });
  };

  SGR_RE.lastIndex = 0;
  while ((match = SGR_RE.exec(clean))) {
    push(clean.slice(cursor, match.index));
    applySgr(state, match[1] ?? "");
    cursor = match.index + match[0].length;
  }
  push(clean.slice(cursor));
  return spans.length ? spans : [{ text: clean }];
}
