import { execFile } from "node:child_process";
import { promisify } from "node:util";

export const execFileAsync = promisify(execFile);

export async function git(cwd: string, args: string[], maxBuffer = 1024 * 1024): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer });
  return stdout;
}
