import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ipcMain } from "electron";

import { completeOnce } from "./model-api";

import type {
  GitBranchInfo,
  GitBranches,
  GitFileChange,
  GitLogEntry,
  GitPullRequest,
  GitStatus,
} from "@zen/shared";

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

/** 未跟踪文件按行数计入新增（上限 2000，避免超大文件拖慢 status） */
async function countFileLines(cwd: string, path: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync("wc", ["-l", path], { cwd, maxBuffer: 64 * 1024 });
    const n = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? "0", 10);
    return Number.isFinite(n) ? Math.min(n, 2000) : 0;
  } catch {
    return 0;
  }
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
        let add = 0;
        let del = 0;
        if (untracked) {
          add = await countFileLines(workdir, path);
        } else {
          const staged = stagedStat.get(path);
          const unstaged = unstagedStat.get(path);
          add = (staged?.add ?? 0) + (unstaged?.add ?? 0);
          del = (staged?.del ?? 0) + (unstaged?.del ?? 0);
        }
        files.push({ path, x, y, add, del, untracked });
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
      options?: { push?: boolean; includeUnstaged?: boolean; autoMessage?: boolean },
    ): Promise<{ ok: boolean; error?: string; output?: string; message?: string }> => {
      const workdir = cwd || process.cwd();
      const push = options?.push ?? false;
      const includeUnstaged = options?.includeUnstaged ?? true;
      let trimmed = (message ?? "").trim();

      try {
        // 任意提交相关操作：空 message 一律现场生成（AI 优先，失败用变更摘要兜底）
        if (!trimmed && options?.autoMessage !== false) {
          trimmed = (await generateAiMessage(workdir).catch(() => "")).trim();
        }
        if (!trimmed && options?.autoMessage !== false) {
          trimmed = await fallbackCommitMessage(workdir);
        }
        if (!trimmed) {
          return { ok: false, error: "提交信息不能为空" };
        }
        if (includeUnstaged) {
          await git(workdir, ["add", "--", ...(files.length ? files : ["."])]);
        }
        const commitOut = await git(workdir, ["commit", "-m", trimmed]);
        if (push) {
          const pushOut = await git(workdir, ["push"]);
          return {
            ok: true,
            message: trimmed,
            output: `${commitOut.trim()}\n${pushOut.trim()}`.trim(),
          };
        }
        return { ok: true, message: trimmed, output: commitOut.trim() };
      } catch (error) {
        const err = error as { stderr?: string; message?: string };
        return { ok: false, error: err.stderr?.trim() || err.message || "提交失败" };
      }
    },
  );

  ipcMain.handle(
    "git:push",
    async (_event, cwd?: string): Promise<{ ok: boolean; error?: string; output?: string }> => {
      const workdir = cwd || process.cwd();
      try {
        const output = await git(workdir, ["push"]);
        return { ok: true, output: output.trim() };
      } catch (error) {
        const err = error as { stderr?: string; message?: string };
        return { ok: false, error: err.stderr?.trim() || err.message || "推送失败" };
      }
    },
  );

  ipcMain.handle("git:branches", async (_event, cwd?: string): Promise<GitBranches> => {
    const workdir = cwd || process.cwd();
    try {
      const [localOut, remoteOut] = await Promise.all([
        git(workdir, ["branch", "--format=%(HEAD)\t%(refname:short)"]),
        git(workdir, ["branch", "-r", "--format=%(HEAD)\t%(refname:short)"]),
      ]);
      const local: GitBranchInfo[] = localOut
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [head = "", name = ""] = line.split("\t");
          return { name, current: head === "*" };
        })
        .filter((item) => item.name);
      const remote: GitBranchInfo[] = remoteOut
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const [head = "", name = ""] = line.split("\t");
          const slash = name.indexOf("/");
          const remoteName = slash > 0 ? name.slice(0, slash) : undefined;
          return {
            name,
            current: head === "*",
            remote: remoteName,
          };
        })
        .filter((item) => item.name && item.name !== "HEAD");
      return { local, remote };
    } catch {
      return { local: [], remote: [] };
    }
  });

  ipcMain.handle(
    "git:checkout",
    async (_event, cwd: string | undefined, name: string): Promise<{ ok: boolean; error?: string }> => {
      const branch = name.trim();
      if (!branch) {
        return { ok: false, error: "分支名不能为空" };
      }
      const workdir = cwd || process.cwd();
      try {
        await git(workdir, ["checkout", branch]);
        return { ok: true };
      } catch (error) {
        const err = error as { stderr?: string; message?: string };
        return { ok: false, error: err.stderr?.trim() || err.message || "切换分支失败" };
      }
    },
  );

  ipcMain.handle(
    "git:pr",
    async (_event, cwd?: string): Promise<GitPullRequest | null> => {
      const workdir = cwd || process.cwd();
      try {
        const branch = (await git(workdir, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
        const { stdout } = await execFileAsync(
          "gh",
          ["pr", "view", branch, "--json", "number,title,url,state,isDraft"],
          { cwd: workdir, maxBuffer: 256 * 1024 },
        );
        const data = JSON.parse(stdout) as {
          number?: number;
          title?: string;
          url?: string;
          state?: string;
          isDraft?: boolean;
        };
        if (data.number == null || !data.url) {
          return null;
        }
        const state = data.isDraft
          ? "draft"
          : data.state === "MERGED"
            ? "merged"
            : data.state === "CLOSED"
              ? "closed"
              : "open";
        return {
          number: data.number,
          title: data.title ?? `#${data.number}`,
          url: data.url,
          state,
        };
      } catch {
        return null;
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
    return generateAiMessage(workdir);
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

async function generateAiMessage(workdir: string): Promise<string> {
  const [diffStat, numstat, subjects, status] = await Promise.all([
    git(workdir, ["diff", "HEAD", "--stat"]).catch(() => ""),
    git(workdir, ["diff", "HEAD", "--numstat"]).catch(() => ""),
    git(workdir, ["log", "--pretty=format:%s", "--max-count=5"]).catch(() => ""),
    git(workdir, ["status", "--porcelain"]).catch(() => ""),
  ]);
  const files = status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40)
    .join("\n");
  const prompt = [
    "根据下面的 git 变更，写一条简洁的中文 commit 信息。",
    "格式：一行动词开头的主题（不超过 50 字），不要输出其他解释、引号或列表。",
    "",
    `最近提交风格参考：${subjects || "无"}`,
    "",
    "变更文件：",
    files || "（无）",
    "",
    "行数增减：",
    numstat || "（无）",
    "",
    "统计摘要：",
    diffStat || "（无变更）",
  ].join("\n");
  return completeOnce(prompt, { maxTokens: 160 });
}

/** AI 不可用时的确定性兜底 commit message，保证提交链路不会因空 message 失败 */
async function fallbackCommitMessage(workdir: string): Promise<string> {
  const status = await git(workdir, ["status", "--porcelain"]).catch(() => "");
  const paths = status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const path = line.slice(3);
      return path.includes(" -> ") ? path.split(" -> ").pop()! : path;
    })
    .filter(Boolean);

  if (!paths.length) {
    return "chore: commit workspace changes";
  }
  if (paths.length === 1) {
    return `chore: update ${paths[0]}`;
  }
  return `chore: update ${paths.length} files (${paths[0]}…)`;
}
