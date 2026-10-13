import { findToolOnPath } from "../memory";

import type { ToolAvailability } from "./commands";
import { defaultSwiftCacheRoot } from "./swift-tools";

/** 批量探测命令是否在 PATH 上（复用 memory 的 PATH 解析：Windows 兼容 .cmd/.exe/.bat） */
export async function checkTools(names: string[]): Promise<ToolAvailability> {
  const pathValue = process.env["PATH"] ?? process.env["Path"] ?? "";
  const entries = await Promise.all(
    names.map(async (name) => {
      const found = await findToolOnPath(name, pathValue, process.platform);
      return [name, found != null] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/** PS1 脚本名 → ~/.zen/cache/bin 下的落盘路径（与 Swift 产物同住 bin/） */
export function ps1ScriptPath(name: string): string {
  return `${defaultSwiftCacheRoot()}/bin/${name}.ps1`;
}
