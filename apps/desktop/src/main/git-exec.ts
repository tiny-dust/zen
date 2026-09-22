import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

/** 解析 git 工作目录：显式 cwd 优先（可为相对路径），否则进程 cwd；恒返回绝对路径 */
export function resolveWorkdir(cwd?: string): string {
  return path.resolve(cwd?.trim() || process.cwd());
}

export async function git(cwd: string, args: string[], maxBuffer = 1024 * 1024): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer });
  return stdout;
}
