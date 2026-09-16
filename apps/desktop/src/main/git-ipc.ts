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
      const [porcelain, unstaged, staged, upstream] = await Promise.all([
        git(workdir, ["status", "--porcelain"]),
        git(workdir, ["diff", "--numstat"]),
        git(workdir, ["diff", "--cached", "--numstat"]),
        // 左=上游独有（落后），右=本地独有（待推送）；无上游时为空
        git(workdir, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]).catch(() => ""),
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
      const [behind = "", ahead = ""] = upstream.trim().split("\t");
      return {
        branch,
        files,
        ahead: upstream ? Number(ahead) || 0 : undefined,
        behind: upstream ? Number(behind) || 0 : undefined,
      };
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

const AI_DIFF_LIMIT = 12 * 1024;
const HISTORY_LIMIT = 4 * 1024;
const SUBJECT_LIMIT = 72;
const BODY_LIMIT = 600;
const CONVENTIONAL_RE =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]+\))?:\s?\S/i;
const SYSTEM_PROMPT = [
  "你是 Git commit message 生成器，全部输出就是一条 commit message 本身。",
  "第一行为 type(scope): 简短主题（type 从 feat/fix/docs/style/refactor/perf/test/chore 中选，scope 可选），空一行后为 1-3 行正文。",
  "禁止输出思考过程、任务复述、变更分析、解释、markdown 代码块或引号。",
].join("\n");

/** 历史提交大多遵循 Conventional Commits 时返回 true，决定沿用历史风格还是标准模板 */
function historyIsConventional(commits: string[]): boolean {
  const subjects = commits
    .map((block) => (block.split("\n").find((line) => line.trim()) ?? "").trim())
    .filter(Boolean);
  if (!subjects.length) {
    return false;
  }
  const hits = subjects.filter((subject) => CONVENTIONAL_RE.test(subject)).length;
  return hits / subjects.length >= 0.5;
}

/** 正文超长时按行边界截断，避免 commit message 失控 */
function capBody(body: string): string {
  if (body.length <= BODY_LIMIT) {
    return body;
  }
  const cut = body.slice(0, BODY_LIMIT);
  const nl = cut.lastIndexOf("\n");
  return (nl > 0 ? cut.slice(0, nl) : cut).trimEnd();
}

/** 主题截断后去掉残缺的括号/引号，避免以半个「（」结尾 */
function capSubject(subject: string): string {
  if (subject.length <= SUBJECT_LIMIT) {
    return subject;
  }
  return subject
    .slice(0, SUBJECT_LIMIT)
    .replace(/[\s（(【\[{《"'“”]+$/u, "")
    .trimEnd();
}

/** 把模型原始输出净化成 commit message：定位首个符合 Conventional Commits 的行作主题，其后为正文。
 *  找不到合格主题（如模型输出任务分析/思考内容）时返回空串，交给确定性兜底 */
function toCommitMessage(raw: string): string {
  const lines = raw
    .split("\n")
    .filter((line) => !/^\s*```/.test(line))
    .map((line) => line.trimEnd());
  const subjectIndex = lines.findIndex((line) => CONVENTIONAL_RE.test(line.trim()));
  if (subjectIndex < 0) {
    return "";
  }
  const subject = (lines[subjectIndex] ?? "")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  const cappedSubject = capSubject(subject);
  const body = capBody(
    lines
      .slice(subjectIndex + 1)
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  );
  return body ? `${cappedSubject}\n\n${body}` : cappedSubject;
}

async function generateAiMessage(workdir: string): Promise<string> {
  const [diffStat, numstat, status, diffBody, historyRaw] = await Promise.all([
    git(workdir, ["diff", "HEAD", "--stat"]).catch(() => ""),
    git(workdir, ["diff", "HEAD", "--numstat"]).catch(() => ""),
    git(workdir, ["status", "--porcelain"]).catch(() => ""),
    git(workdir, ["diff", "HEAD", "--no-color", "-U1"]).catch(() => ""),
    git(workdir, ["log", "-n", "5", "--pretty=format:---%n%B"]).catch(() => ""),
  ]);
  const files = status
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 40)
    .join("\n");
  const diff =
    diffBody.length > AI_DIFF_LIMIT
      ? `${diffBody.slice(0, AI_DIFF_LIMIT)}\n… diff 已截断`
      : diffBody;
  const historyRawTrimmed = historyRaw.trim();
  const history =
    historyRawTrimmed.length > HISTORY_LIMIT
      ? `${historyRawTrimmed.slice(0, HISTORY_LIMIT)}\n… 历史已截断`
      : historyRawTrimmed;
  const commits = history
    .split(/^---$/m)
    .map((block) => block.trim())
    .filter(Boolean);
  const styleHint = historyIsConventional(commits)
    ? "最近提交遵循 Conventional Commits：沿用其常用的 type 与 scope 习惯。"
    : "最近提交缺失或不规范：忽略其风格，直接使用标准模板。";
  const prompt = [
    "根据下面的 git 变更，为本次变更写一条中文 commit message。",
    "标准模板：第一行为 type(scope): 简短主题（不超过 50 字），type 从 feat/fix/docs/style/refactor/perf/test/chore 中选，scope 可选；空一行；正文用 1-3 行说明本次变更的动机与要点。",
    styleHint,
    "只输出 commit message 本身，不要输出思考过程、解释、markdown 代码块或引号。",
    "",
    "最近提交（风格参考）：",
    history || "（无）",
    "",
    "变更文件：",
    files || "（无）",
    "",
    "行数增减：",
    numstat || "（无）",
    "",
    "统计摘要：",
    diffStat || "（无变更）",
    "",
    "变更内容（diff）：",
    diff || "（无）",
  ].join("\n");
  return toCommitMessage(await completeOnce(prompt, { maxTokens: 2048, system: SYSTEM_PROMPT }));
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
