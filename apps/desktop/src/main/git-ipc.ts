import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ipcMain } from "electron";

import { completeOnce } from "./model-api";

import type { GitFileChange, GitLogEntry, GitStatus } from "@zen/shared";

const execFileAsync = promisify(execFile);

const DIFF_LIMIT = 200 * 1024;

async function git(cwd: string, args: string[], maxBuffer = 1024 * 1024): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer });
  return stdout;
}

function parseNumstat(output: string): Map<string, { add: number; del: number }> {
  const map = new Map<string, { add: number; del: number }>();
  for (const line of output.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [add = "-", del = "-", path = ""] = line.split("\t");
    if (!path) {
      continue;
    }
    map.set(path, {
      add: add === "-" ? 0 : Number(add) || 0,
      del: del === "-" ? 0 : Number(del) || 0,
    });
  }
  return map;
}

export function registerGitIpc(): void {
  ipcMain.handle("git:status", async (_event, cwd?: string): Promise<GitStatus | null> => {
    const workdir = cwd || process.cwd();
    try {
      const branch = (await git(workdir, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
      const [porcelain, unstaged, staged] = await Promise.all([
        git(workdir, ["status", "--porcelain"]),
        git(workdir, ["diff", "--numstat"]),
        git(workdir, ["diff", "--cached", "--numstat"]),
      ]);
      const unstagedStat = parseNumstat(unstaged);
      const stagedStat = parseNumstat(staged);
      const files: GitFileChange[] = [];
      for (const line of porcelain.split("\n")) {
        if (line.length < 4) {
          continue;
        }
        const x = line[0] ?? " ";
        const y = line[1] ?? " ";
        let path = line.slice(3);
        if (path.includes(" -> ")) {
          path = path.split(" -> ").pop()!;
        }
        const untracked = x === "?" && y === "?";
        const stat = untracked
          ? { add: 0, del: 0 }
          : stagedStat.get(path) ?? unstagedStat.get(path) ?? { add: 0, del: 0 };
        files.push({ path, x, y, add: stat.add, del: stat.del, untracked });
      }
      return { branch, files };
    } catch {
      return null;
    }
  });

  ipcMain.handle(
    "git:diff",
    async (_event, cwd: string | undefined, path: string, staged = false): Promise<string | null> => {
      const workdir = cwd || process.cwd();
      try {
        const args = ["diff", "--no-color"];
        if (staged) {
          args.push("--cached");
        }
        args.push("--", path);
        const output = await git(workdir, args, DIFF_LIMIT * 2);
        return output.length > DIFF_LIMIT ? `${output.slice(0, DIFF_LIMIT)}\n… diff 已截断` : output;
      } catch {
        return null;
      }
    },
  );

  ipcMain.handle(
    "git:commit",
    async (
      _event,
      cwd: string | undefined,
      message: string,
      files: string[],
      push = false,
    ): Promise<{ ok: boolean; error?: string; output?: string }> => {
      const workdir = cwd || process.cwd();
      const trimmed = message.trim();
      if (!trimmed) {
        return { ok: false, error: "提交信息不能为空" };
      }
      try {
        await git(workdir, ["add", "--", ...(files.length ? files : ["."])]);
        const commitOut = await git(workdir, ["commit", "-m", trimmed]);
        if (push) {
          const pushOut = await git(workdir, ["push"]);
          return { ok: true, output: `${commitOut.trim()}\n${pushOut.trim()}`.trim() };
        }
        return { ok: true, output: commitOut.trim() };
      } catch (error) {
        const err = error as { stderr?: string; message?: string };
        return { ok: false, error: err.stderr?.trim() || err.message || "提交失败" };
      }
    },
  );

  ipcMain.handle("git:log", async (_event, cwd?: string): Promise<GitLogEntry[]> => {
    const workdir = cwd || process.cwd();
    const SEP = "\u001f";
    try {
      const output = await git(workdir, [
        "log",
        "--date=unix",
        `--pretty=format:%H${SEP}%P${SEP}%an${SEP}%at${SEP}%s`,
        "--max-count=200",
      ]);
      return output
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          const [hash = "", parents = "", author = "", time = "0", subject = ""] =
            line.split(SEP);
          return {
            hash,
            parents: parents ? parents.split(" ").filter(Boolean) : [],
            author,
            time: Number(time) * 1000,
            subject,
          };
        });
    } catch {
      return [];
    }
  });

  ipcMain.handle("git:ai-message", async (_event, cwd?: string): Promise<string> => {
    const workdir = cwd || process.cwd();
    const diffStat = await git(workdir, ["diff", "HEAD", "--stat"]).catch(() => "");
    const subjects = await git(workdir, ["log", "--pretty=format:%s", "--max-count=5"]).catch(
      () => "",
    );
    const prompt = [
      "根据下面的 git 变更摘要，写一条简洁的中文 commit 信息。",
      "格式：一行动词开头的主题（不超过 50 字），不要输出其他解释或引号。",
      "",
      `最近提交风格参考：${subjects || "无"}`,
      "",
      diffStat || "（无变更）",
    ].join("\n");
    return completeOnce(prompt, { maxTokens: 120 });
  });

  ipcMain.handle(
    "git:create-branch",
    async (_event, cwd: string | undefined, name: string): Promise<{ ok: boolean; error?: string }> => {
      const branch = name.trim();
      if (!branch || /[\s~^:?*[\\\u0000]/.test(branch)) {
        return { ok: false, error: "分支名不合法" };
      }
      const workdir = cwd || process.cwd();
      try {
        await git(workdir, ["checkout", "-b", branch]);
        return { ok: true };
      } catch (error) {
        const err = error as { stderr?: string; message?: string };
        return { ok: false, error: err.stderr?.trim() || err.message || "创建分支失败" };
      }
    },
  );
}
