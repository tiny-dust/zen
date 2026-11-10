import type { McpServerConfig } from "@zen/shared";

/** 仅解析 npx 的命令与参数，不经 shell 执行粘贴内容。 */
export function parseNpxCommand(input: string): Pick<McpServerConfig, "name" | "command" | "args"> | null {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  const text = input.trim();
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (escaping) {
      token += char;
      escaping = false;
    } else if (char === "\\" && quote !== "'" && /[\s"'\\;&|<>`$]/.test(text[index + 1] ?? "")) {
      escaping = true;
    } else if (quote) {
      if (char === quote) quote = null;
      else token += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (/\s/.test(char)) {
      if (token) tokens.push(token);
      token = "";
    } else if (/[;&|<>`$]/.test(char)) {
      return null;
    } else {
      token += char;
    }
  }
  if (escaping || quote) return null;
  if (token) tokens.push(token);
  if (tokens[0] !== "npx") return null;
  const args = tokens.slice(1);
  const packageIndex = args.findIndex((arg) => !arg.startsWith("-"));
  if (packageIndex < 0) return null;
  const packageName = args[packageIndex]!;
  const name = packageName.split("/").at(-1)?.replace(/@[^@]+$/, "");
  if (!name || !/^[\w.-]+$/.test(name)) return null;
  if (!args.includes("-y") && !args.includes("--yes")) args.unshift("-y");
  return { name, command: "npx", args };
}
