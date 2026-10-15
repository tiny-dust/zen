import { git } from "./git-exec";

import type { GitStashEntry, GitSyncResult } from "@zen/shared";

/** 分支/ref 名校验：非空、无空白与 git 特殊字符、不以 - 开头（防被当旗标解析注入）。
 *  与 git-ipc-write 的 create-branch 同口径，本地/远程分支名（origin/feature-x）均通过 */
export function isSafeRefName(name: string): boolean {
  const trimmed = name.trim();
  return !!trimmed && !trimmed.startsWith("-") && !/[\s~^:?*[\\\u0000]/.test(trimmed);
}

/** 把 git 子进程异常转成可读错误：stderr 优先（git 的真实报错），回退 message，再回退默认文案。
 *  与 git-ipc-write 各 handler 的 catch 口径一致，抽出来供远端同步组复用 */
export function describeGitError(error: unknown, fallback: string): string {
  const err = error as { stderr?: string; message?: string };
  return err.stderr?.trim() || err.message || fallback;
}

/** 当前分支领先/落后上游的提交数（左=落后，右=领先）；无上游时返回空对象（与 git:status 同口径） */
export async function countAheadBehind(
  workdir: string,
): Promise<{ ahead?: number; behind?: number }> {
  const out = await git(workdir, ["rev-list", "--left-right", "--count", "@{upstream}...HEAD"]).catch(
    () => "",
  );
  if (!out.trim()) {
    return {};
  }
  const [behind = "", ahead = ""] = out.trim().split("\t");
  return { ahead: Number(ahead) || 0, behind: Number(behind) || 0 };
}

/** 未合并（冲突）文件列表：quotepath=false 保证中文/特殊字符路径原样输出 */
async function conflictFiles(workdir: string): Promise<string[]> {
  const out = await git(workdir, [
    "-c",
    "core.quotepath=false",
    "diff",
    "--name-only",
    "--diff-filter=U",
  ]).catch(() => "");
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/** fetch：刷新远端状态并返回当前分支 ahead/behind（无上游时省略计数） */
export async function fetchRemote(workdir: string): Promise<GitSyncResult> {
  try {
    await git(workdir, ["fetch"]);
    return { ok: true, ...(await countAheadBehind(workdir)) };
  } catch (error) {
    return { ok: false, error: describeGitError(error, "获取远端更新失败") };
  }
}

/** pull：先确认当前分支有上游（无则给清晰提示），再按仓库配置的默认策略拉取
 *  （不加 --rebase/--ff-only，pull.rebase 等用户配置生效）；冲突时不自动 commit，返回冲突文件 */
export async function pullRemote(workdir: string): Promise<GitSyncResult> {
  try {
    await git(workdir, ["rev-parse", "--abbrev-ref", "@{upstream}"]);
  } catch {
    return { ok: false, error: "当前分支没有上游分支，请先推送以建立追踪关系" };
  }
  try {
    const output = await git(workdir, ["pull", "--no-edit"]);
    return { ok: true, output: output.trim(), ...(await countAheadBehind(workdir)) };
  } catch (error) {
    return {
      ok: false,
      conflicts: await conflictFiles(workdir),
      error: describeGitError(error, "拉取失败"),
    };
  }
}

/** merge 指定分支：冲突时 git 自动停在未提交状态，返回冲突文件让 UI 引导在变更面板解决 */
export async function mergeBranch(workdir: string, branch: string): Promise<GitSyncResult> {
  if (!isSafeRefName(branch)) {
    return { ok: false, error: "分支名不合法" };
  }
  try {
    const output = await git(workdir, ["merge", "--no-edit", branch.trim()]);
    return { ok: true, output: output.trim() };
  } catch (error) {
    return {
      ok: false,
      conflicts: await conflictFiles(workdir),
      error: describeGitError(error, "合并失败"),
    };
  }
}

/** 中止进行中的合并（无合并时 git 自身报错原样透传） */
export async function abortMerge(workdir: string): Promise<GitSyncResult> {
  try {
    const output = await git(workdir, ["merge", "--abort"]);
    return { ok: true, output: output.trim() };
  } catch (error) {
    return { ok: false, error: describeGitError(error, "中止合并失败") };
  }
}

/** 撤回工作区改动（不可恢复，UI 侧已二次确认）：
 *  - 指定文件：已跟踪（含已暂存）用 checkout HEAD -- 恢复；未跟踪（??）用 clean -f -- 删除
 *  - 全部（files 为空）：reset --hard HEAD 恢复所有已跟踪文件 + clean -fd 删除未跟踪
 *    （clean 不带 -x：忽略文件/目录不动，避免误删 node_modules 等） */
export async function discardChanges(
  workdir: string,
  files?: string[],
): Promise<GitSyncResult> {
  try {
    const paths = (files ?? []).map((file) => file.trim()).filter(Boolean);
    if (paths.length) {
      // 按 porcelain 状态分类：?? 开头为未跟踪，其余（含冲突 U*）按已跟踪恢复
      const statusOut = await git(workdir, [
        "-c",
        "core.quotepath=false",
        "status",
        "--porcelain",
        "--",
        ...paths,
      ]);
      const untracked: string[] = [];
      const tracked: string[] = [];
      for (const line of statusOut.split("\n")) {
        if (!line.trim()) {
          continue;
        }
        const path = line.slice(3);
        if (line.startsWith("??")) {
          untracked.push(path);
        } else {
          tracked.push(path);
        }
      }
      // 请求的路径不在 status 输出（已无改动）：checkout 幂等，跳过即可
      if (tracked.length) {
        await git(workdir, ["checkout", "HEAD", "--", ...tracked]);
      }
      if (untracked.length) {
        await git(workdir, ["clean", "-f", "--", ...untracked]);
      }
      return { ok: true };
    }
    await git(workdir, ["reset", "--hard", "HEAD"]);
    await git(workdir, ["clean", "-fd"]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: describeGitError(error, "撤回更改失败") };
  }
}

/** stash@{n} 参数拼装：只接受非负整数，防任意 ref 注入（execFile 不经 shell，仍收口） */
function stashRef(index: number): string | null {
  return Number.isInteger(index) && index >= 0 ? `stash@{${index}}` : null;
}

/** 贮藏当前变更：-u 连未跟踪文件一起收；无可贮藏变更时前置报错（免走 stash 之后的英文输出） */
export async function stashPush(workdir: string, message?: string): Promise<GitSyncResult> {
  try {
    const status = await git(workdir, ["status", "--porcelain"]);
    if (!status.trim()) {
      return { ok: false, error: "没有可贮藏的变更" };
    }
    const args = ["stash", "push", "-u"];
    const msg = message?.trim();
    if (msg) {
      args.push("-m", msg);
    }
    const output = await git(workdir, args);
    return { ok: true, output: output.trim() };
  } catch (error) {
    return { ok: false, error: describeGitError(error, "贮藏失败") };
  }
}

/** 应用贮藏：apply 保留 stash 条目；pop 应用成功后顺手删除（冲突时 pop 不删除） */
export async function stashApply(
  workdir: string,
  index: number,
  mode: "apply" | "pop",
): Promise<GitSyncResult> {
  const ref = stashRef(index);
  if (!ref) {
    return { ok: false, error: "贮藏序号不合法" };
  }
  try {
    const output = await git(workdir, ["stash", mode, ref]);
    return { ok: true, output: output.trim() };
  } catch (error) {
    return {
      ok: false,
      conflicts: await conflictFiles(workdir),
      error: describeGitError(error, "应用贮藏失败"),
    };
  }
}

/** 删除指定贮藏 */
export async function stashDrop(workdir: string, index: number): Promise<GitSyncResult> {
  const ref = stashRef(index);
  if (!ref) {
    return { ok: false, error: "贮藏序号不合法" };
  }
  try {
    const output = await git(workdir, ["stash", "drop", ref]);
    return { ok: true, output: output.trim() };
  } catch (error) {
    return { ok: false, error: describeGitError(error, "删除贮藏失败") };
  }
}

/** 贮藏列表：%gd=stash@{n} %h=短哈希 %s=主题；%gd 解析失败时按行序兜底 */
export async function stashList(workdir: string): Promise<GitStashEntry[]> {
  const out = await git(workdir, ["stash", "list", "--format=%gd\t%h\t%s"]).catch(() => "");
  const entries: GitStashEntry[] = [];
  let position = 0;
  for (const line of out.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    const [ref = "", hash = "", ...messageParts] = line.split("\t");
    // 主题按原样拼回（极端情况下消息本身含 \t）
    const message = messageParts.join("\t").trim();
    const match = /stash@\{(\d+)\}/.exec(ref);
    entries.push({ index: match ? Number(match[1]) : position, hash, message });
    position += 1;
  }
  return entries;
}
