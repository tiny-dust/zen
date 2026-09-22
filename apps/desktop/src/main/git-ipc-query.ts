import { ipcMain } from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { execFileAsync, git, resolveWorkdir } from "./git-exec";

import type {
  GitBranchInfo,
  GitBranches,
  GitCommitDetail,
  GitCommitFile,
  GitFileChange,
  GitLogEntry,
  GitPullRequest,
  GitStatus,
} from "@zen/shared";

const DIFF_LIMIT = 200 * 1024;
const COMMIT_HASH_RE = /^[0-9a-f]{4,40}$/i;

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

/** 重命名路径 "old -> new" 取新路径 */
function normalizeDiffPath(path: string): string {
  return path.includes(" -> ") ? (path.split(" -> ").pop() ?? "") : path;
}

/** 未跟踪文件按行数计入新增（上限 2000，避免超大文件拖慢 status）。
 *  纯 JS 计数：跨平台（Windows 无 wc）且免每文件起子进程（status 轮询时不堆积进程） */
async function countFileLines(cwd: string, relPath: string): Promise<number> {
  try {
    const content = await readFile(path.resolve(cwd, relPath), "utf8");
    const rows = content.split("\n");
    if (rows[rows.length - 1] === "") {
      rows.pop();
    }
    return Math.min(rows.length, 2000);
  } catch {
    return 0;
  }
}

/** 只读组：status / diff / branches / pr / log / commit-detail / commit-diff */
export function registerGitQueryIpc(): void {
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

  ipcMain.handle("git:branches", async (_event, cwd?: string): Promise<GitBranches> => {
    const workdir = resolveWorkdir(cwd);
    try {
      // for-each-ref 一次枚举本地/远程分支。注意：%(HEAD) 对非当前分支是空格，
      // 整行 trim 会吃掉首列导致后续列错位，必须先按 \t 拆分再逐列 trim；
      // symref 非空（origin/HEAD -> origin/main）是符号引用，跳过
      const out = await git(workdir, [
        "for-each-ref",
        "refs/heads",
        "refs/remotes",
        "--format=%(HEAD)\t%(refname:short)\t%(refname)\t%(symref)",
      ]);
      const local: GitBranchInfo[] = [];
      const remote: GitBranchInfo[] = [];
      for (const line of out.split("\n")) {
        const [head = "", short = "", refname = "", symref = ""] = line.split("\t");
        const name = short.trim();
        if (!name || symref.trim()) {
          continue;
        }
        if (refname.startsWith("refs/heads/")) {
          local.push({ name, current: head.trim() === "*" });
        } else if (refname.startsWith("refs/remotes/") && !name.endsWith("/HEAD")) {
          const slash = name.indexOf("/");
          remote.push({
            name,
            current: false,
            remote: slash > 0 ? name.slice(0, slash) : undefined,
          });
        }
      }
      // 无 remote-tracking ref（如从未 fetch）时用 ls-remote 兜底枚举远程分支；失败静默降级
      if (!remote.length) {
        const remoteNames = (await git(workdir, ["remote"]).catch(() => ""))
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean);
        for (const remoteName of remoteNames) {
          const listing = await git(workdir, ["ls-remote", "--heads", remoteName]).catch(() => "");
          for (const line of listing.split("\n")) {
            const ref = line.split("\t")[1]?.trim() ?? "";
            if (!ref.startsWith("refs/heads/")) {
              continue;
            }
            const name = `${remoteName}/${ref.slice("refs/heads/".length)}`;
            if (!remote.some((item) => item.name === name)) {
              remote.push({ name, current: false, remote: remoteName });
            }
          }
        }
      }
      return { local, remote };
    } catch {
      return { local: [], remote: [] };
    }
  });

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

  ipcMain.handle(
    "git:log",
    async (_event, cwd?: string, ref?: string): Promise<GitLogEntry[]> => {
      const workdir = cwd || process.cwd();
      const SEP = "\u001f";
      // ref 指向具体分支时按该分支取历史；缺省 --all 画全部分支泳道。
      // ref 以 "-" 开头会被 git 当作旗标解析，直接拒绝（fail fast）。
      const range = ref && !ref.startsWith("-") ? [ref] : ["--all"];
      try {
        // 缺省按提交时间排序（与 VS Code 图谱一致）：HEAD 所在分支的链紧跟 merge 展示；
        // git 本身保证父提交不会先于子提交出现，泳道算法不受影响
        const output = await git(workdir, [
          "log",
          ...range,
          "--date=unix",
          `--pretty=format:%H${SEP}%P${SEP}%an${SEP}%at${SEP}%s${SEP}%D`,
          "--max-count=200",
        ]);
        return output
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => {
            const [hash = "", parents = "", author = "", time = "0", subject = "", ...refParts] =
              line.split(SEP);
            return {
              hash,
              parents: parents ? parents.split(" ").filter(Boolean) : [],
              author,
              time: Number(time) * 1000,
              subject,
              refs: refParts
                .join(SEP)
                .split(",")
                .map((ref) => ref.trim())
                .filter(Boolean),
            };
          });
      } catch {
        return [];
      }
    },
  );

  /** 提交详情（图谱展开）：完整信息 + 首父对比的变更文件 */
  ipcMain.handle(
    "git:commit-detail",
    async (_event, cwd: string | undefined, hash: string): Promise<GitCommitDetail | null> => {
      if (!COMMIT_HASH_RE.test(hash)) {
        return null;
      }
      const workdir = cwd || process.cwd();
      const SEP = "\u001f";
      try {
        const [infoRaw, numstat, nameStatus] = await Promise.all([
          git(workdir, [
            "log",
            "-1",
            "--date=unix",
            // %B 含完整 message（主题重复一次无碍，正文以 %B 为准）
            `--pretty=format:%H${SEP}%P${SEP}%an${SEP}%ae${SEP}%at${SEP}%cn${SEP}%ce${SEP}%ct${SEP}%s${SEP}%B`,
            hash,
          ]),
          // merge 提交按首父对比；--root 覆盖根提交
          git(workdir, [
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--root",
            "-m",
            "--first-parent",
            "--numstat",
            hash,
          ]),
          git(workdir, [
            "diff-tree",
            "--no-commit-id",
            "-r",
            "--root",
            "-m",
            "--first-parent",
            "--name-status",
            hash,
          ]),
        ]);
        const [hashOut = "", parentsRaw = "", author = "", authorEmail = "", authorTime = "0", committer = "", committerEmail = "", committerTime = "0", subject = "", ...bodyRest] = infoRaw.split(SEP);

        const stats = new Map<string, { add: number; del: number }>();
        for (const line of numstat.split("\n")) {
          if (!line.trim()) {
            continue;
          }
          const [add = "-", del = "-", path = ""] = line.split("\t");
          if (!path) {
            continue;
          }
          stats.set(normalizeDiffPath(path), {
            add: add === "-" ? 0 : Number(add) || 0,
            del: del === "-" ? 0 : Number(del) || 0,
          });
        }
        const files: GitCommitFile[] = [];
        for (const line of nameStatus.split("\n")) {
          if (!line.trim()) {
            continue;
          }
          const [status = "M", ...rest] = line.split("\t");
          const path = normalizeDiffPath(rest.join("\t"));
          if (!path) {
            continue;
          }
          const stat = stats.get(path) ?? { add: 0, del: 0 };
          files.push({ path, status: status.slice(0, 1), add: stat.add, del: stat.del });
        }
        return {
          hash: hashOut || hash,
          parents: parentsRaw ? parentsRaw.split(" ").filter(Boolean) : [],
          author,
          authorEmail,
          committer,
          committerEmail,
          authorTime: Number(authorTime) * 1000,
          committerTime: Number(committerTime) * 1000,
          subject,
          body: bodyRest.join(SEP).replace(/\n$/, ""),
          files,
        };
      } catch {
        return null;
      }
    },
  );

  /** 提交内单个文件的 patch（与 commit-detail 同口径：首父对比，根提交 --root） */
  ipcMain.handle(
    "git:commit-diff",
    async (
      _event,
      cwd: string | undefined,
      hash: string,
      path: string,
    ): Promise<string | null> => {
      if (!COMMIT_HASH_RE.test(hash) || !path.trim()) {
        return null;
      }
      const workdir = cwd || process.cwd();
      try {
        const output = await git(
          workdir,
          ["diff-tree", "--no-commit-id", "--root", "-p", "-m", "--first-parent", hash, "--", path],
          DIFF_LIMIT * 2,
        );
        return output.length > DIFF_LIMIT ? `${output.slice(0, DIFF_LIMIT)}\n… diff 已截断` : output;
      } catch {
        return null;
      }
    },
  );
}
