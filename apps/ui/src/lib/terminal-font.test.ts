import { describe, expect, it } from "vitest";

// 与 packages/tools/terminal 同源的规范化规则（跨三方系统）
function normalizeFontFamilyName(raw: string): string {
  let name = raw.trim().replace(/^["']|["']$/g, "");
  if (!name) return "";
  name = name.replace(/\s+\d+(\.\d+)?$/, "");
  if (/meslo.*nf/i.test(name)) return "MesloLGS NF";
  if (/0xproto.*nerd.*mono/i.test(name)) return "0xProto Nerd Font Mono";
  if (/0xproto.*nerd/i.test(name)) return "0xProto Nerd Font";
  if (/sfmono/i.test(name)) return "SF Mono";
  name = name.replace(/[- ]?(Regular|Medium|Bold|Italic|Light|SemiBold|BoldItalic|Oblique)$/i, "");
  name = name.replace(/-NF$/, "");
  return name.trim();
}

function buildTerminalFontFamily(primary: string): string {
  const families: string[] = [];
  const push = (item: string) => {
    const value = item.trim();
    if (!value) return;
    const quoted = /["']/.test(value) || value === "monospace" ? value : `"${value}"`;
    if (!families.includes(quoted)) families.push(quoted);
  };
  push(primary);
  push("MesloLGS NF");
  push("0xProto Nerd Font");
  push("Cascadia Mono");
  push("SF Mono");
  push("Consolas");
  push("Menlo");
  push("monospace");
  return families.join(", ");
}

describe("terminal font stack (三方系统)", () => {
  it("normalizes iTerm / VS Code / Cascadia font names", () => {
    expect(normalizeFontFamilyName("MesloLGS-NF-Regular 12")).toBe("MesloLGS NF");
    expect(normalizeFontFamilyName("MesloLGS NF")).toBe("MesloLGS NF");
    expect(normalizeFontFamilyName("SFMonoTerminal-Regular")).toBe("SF Mono");
    expect(normalizeFontFamilyName("Cascadia Mono")).toContain("Cascadia");
  });

  it("always puts nerd font fallbacks after primary for icons", () => {
    const stack = buildTerminalFontFamily("Consolas");
    expect(stack.startsWith('"Consolas"')).toBe(true);
    expect(stack).toContain('"MesloLGS NF"');
    expect(stack).toContain('"0xProto Nerd Font"');
    expect(stack.endsWith("monospace")).toBe(true);
  });

  it("builds stack for Windows/Linux primary fonts", () => {
    const win = buildTerminalFontFamily("Cascadia Mono");
    expect(win).toContain('"MesloLGS NF"');
    const linux = buildTerminalFontFamily("DejaVu Sans Mono");
    expect(linux).toContain("monospace");
    expect(linux.startsWith('"DejaVu Sans Mono"')).toBe(true);
  });
});
