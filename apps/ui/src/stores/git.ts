import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type {
  GitBranchInfo,
  GitBranches,
  GitFileChange,
  GitLogEntry,
  GitPullRequest,
  GitStashEntry,
  GitStatus,
  GitSyncResult,
} from "@zen/shared";
import { toast } from "@/components/ui/toast";
import { useChatStore } from "@/stores/chat";
import { useRightPanelStore } from "@/stores/right-panel";
import { useWorkspaceStore } from "@/stores/workspace";
import { i18n } from "@/locales";

export type DiffLayout = "single" | "double";

/** 提交/推送操作类型；空串 = 空闲。状态放 store：关闭提交弹窗后操作继续、信息卡仍能展示 loading */
export type GitOpKind = "commit" | "commit-push" | "push";

export const useGitStore = defineStore("git", () => {
  const status = ref<GitStatus | null>(null);
  const branches = ref<GitBranches>({ local: [], remote: [] });
  const pullRequest = ref<GitPullRequest | null>(null);
  const selectedPath = ref("");
  const diff = ref("");
  const diffLoading = ref(false);
  const loading = ref(false);
  const branchesLoading = ref(false);
  const log = ref<GitLogEntry[]>([]);
  const logLoading = ref(false);
  const diffLayout = ref<DiffLayout>("single");
  const commitPanelOpen = ref(false);
  const branchPickerOpen = ref(false);
  const feedback = ref("");
  /** 提交/推送进行中的操作；跨组件（提交弹窗、信息卡）共享，弹窗关闭不影响操作继续执行 */
  const opBusy = ref<GitOpKind | "">("");
  /** 贮藏列表（stash Popover 数据源）；打开浮层或操作后刷新 */
  const stashes = ref<GitStashEntry[]>([]);
  const stashesLoading = ref(false);
  /** 右侧 diff tab：图谱 tab 固定存在（"graph"），点击变更文件追加文件 tab */
  const diffTabs = ref<string[]>([]);
  const activeDiffTab = ref<string>("graph");

  function cwd(): string | undefined {
    return useWorkspaceStore().pathOf(useChatStore().sessionWorkspaceId);
  }

  /** commit AI 生成用的模型：当前会话生效模型（会话覆盖 > 全局默认）。
   *  全局兜底会按名称排序取第一个启用模型，可能选中不合适的推理模型（实测 glm 把
   *  输出预算全部耗在 reasoning 上导致永远走 fallback "chore: update ..."），显式传会话模型规避 */
  function completionModel(): { providerId?: string; modelId?: string } {
    const sel = useChatStore().effectiveSelection;
    return sel.providerId && sel.modelId
      ? { providerId: sel.providerId, modelId: sel.modelId }
      : {};
  }

  const files = computed(() => status.value?.files ?? []);
  const branch = computed(() => status.value?.branch || useChatStore().branch);
  const totalAdd = computed(() => files.value.reduce((sum, item) => sum + item.add, 0));
  const totalDel = computed(() => files.value.reduce((sum, item) => sum + item.del, 0));
  const hasChanges = computed(() => files.value.length > 0);

  /** 应用一次 status 结果：更新文件列表并校正 tab/diff、同步 chat 分支信息 */
  function applyStatus(next: GitStatus | null) {
    status.value = next;
    const valid = new Set(files.value.map((item) => item.path));
    // 文件已提交/被撤回后：关闭对应 diff tab；激活 tab 失效则回退到相邻 tab 或图谱
    diffTabs.value = diffTabs.value.filter((path) => valid.has(path));
    if (activeDiffTab.value !== "graph" && !valid.has(activeDiffTab.value)) {
      const fallback = diffTabs.value[diffTabs.value.length - 1] ?? "graph";
      activeDiffTab.value = fallback;
      if (fallback === "graph") {
        selectedPath.value = "";
        diff.value = "";
      } else {
        void selectFile(fallback);
      }
    }
    void useChatStore().refreshGit();
  }

  async function refreshStatus() {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      status.value = null;
      return;
    }
    loading.value = true;
    try {
      applyStatus(await zen.git.status(root));
    } finally {
      loading.value = false;
    }
  }

  /** 轮询间隔（面板可见时保持 status 近实时） */
  const POLL_MS = 2500;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let pollInFlight = false;
  /** 订阅计数：信息卡 / 变更面板 / 提交面板各自 start/stop，归零停表 */
  let watchCount = 0;

  /** 后台轮询：静默取 status，结果有变化才写 store（不置 loading，避免刷新图标闪） */
  async function pollStatus() {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root || pollInFlight) {
      return;
    }
    pollInFlight = true;
    try {
      const next = await zen.git.status(root);
      if (JSON.stringify(next) === JSON.stringify(status.value)) {
        return;
      }
      applyStatus(next);
    } catch {
      // 轮询失败静默（如目录暂不可读），保留上次状态，下一轮再试
    } finally {
      pollInFlight = false;
    }
  }

  function stopPollTimer() {
    if (pollTimer != null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function startPollTimer() {
    if (pollTimer != null) {
      return;
    }
    pollTimer = setInterval(() => {
      // 不可见即停表（visibilitychange 未触发的平台兜底）
      if (document.hidden) {
        stopPollTimer();
        return;
      }
      void pollStatus();
    }, POLL_MS);
  }

  /** 窗口重获焦点立即补一次，覆盖失焦/最小化期间停表的时段 */
  function onWindowFocus() {
    void pollStatus();
    startPollTimer();
  }

  /** 页面不可见时清 timer，恢复可见立即刷新并重启轮询 */
  function onVisibilityChange() {
    if (document.hidden) {
      stopPollTimer();
      return;
    }
    void pollStatus();
    startPollTimer();
  }

  /** 面板挂载时订阅轮询；多面板引用计数，全部卸载即停 */
  function startStatusWatch() {
    watchCount += 1;
    if (watchCount > 1) {
      return;
    }
    window.addEventListener("focus", onWindowFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    if (!document.hidden) {
      void pollStatus();
      startPollTimer();
    }
  }

  /** 面板卸载时退订；计数归零清 timer 与监听 */
  function stopStatusWatch() {
    watchCount = Math.max(0, watchCount - 1);
    if (watchCount > 0) {
      return;
    }
    stopPollTimer();
    window.removeEventListener("focus", onWindowFocus);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }

  async function refreshBranches() {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return;
    }
    branchesLoading.value = true;
    try {
      branches.value = await zen.git.branches(root);
      pullRequest.value = await zen.git.pr(root);
    } finally {
      branchesLoading.value = false;
    }
  }

  /** 图谱分支筛选："" = 全部分支（--all），否则按指定 ref 取历史 */
  const logRef = ref("");
  /** 提交历史（图谱视图数据源） */
  async function refreshLog() {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      log.value = [];
      return;
    }
    logLoading.value = true;
    try {
      log.value = await zen.git.log(root, logRef.value || undefined);
    } finally {
      logLoading.value = false;
    }
  }

  /** 切换图谱筛选分支并刷新历史 */
  async function setLogRef(ref: string) {
    if (logRef.value === ref) {
      return;
    }
    logRef.value = ref;
    await refreshLog();
  }

  /** 未跟踪文件没有 git diff：读文件内容合成纯新增 diff（二进制/超限时退化为提示行） */
  function toAddedDiff(path: string, content: string): string {
    const body = content.replace(/\n$/, "");
    const rows = body ? body.split("\n") : [];
    const lines = rows.map((line) => `+${line}`).join("\n");
    return [
      `diff --git a/${path} b/${path}`,
      "new file mode",
      `@@ -0,0 +1,${rows.length} @@`,
      lines,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function selectFile(path: string) {
    selectedPath.value = path;
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      diff.value = "";
      return;
    }
    diffLoading.value = true;
    try {
      const change = files.value.find((item) => item.path === path);
      if (change?.untracked) {
        const content = await zen.workspace.readFile(root, path);
        diff.value = content ? toAddedDiff(path, content.content) : `Binary files ${path} differ`;
        return;
      }
      let raw = await zen.git.diff(root, path);
      if (!raw) {
        // 仅已暂存的文件没有 unstaged diff，回落到 staged diff
        raw = await zen.git.diff(root, path, true);
      }
      diff.value = raw ?? "";
    } finally {
      diffLoading.value = false;
    }
  }

  /** 打开（或激活）文件 diff tab；点击变更文件时调用 */
  function openFileTab(path: string) {
    if (!diffTabs.value.includes(path)) {
      diffTabs.value.push(path);
    }
    activeDiffTab.value = path;
    void selectFile(path);
  }

  /** 关闭文件 diff tab：激活 tab 被关则切到相邻文件 tab，否则回图谱 */
  function closeDiffTab(path: string) {
    const index = diffTabs.value.indexOf(path);
    if (index < 0) {
      return;
    }
    diffTabs.value.splice(index, 1);
    if (activeDiffTab.value === path) {
      const fallback = diffTabs.value[index] ?? diffTabs.value[index - 1];
      if (fallback) {
        activeDiffTab.value = fallback;
        void selectFile(fallback);
      } else {
        activeDiffTab.value = "graph";
        selectedPath.value = "";
        diff.value = "";
      }
    }
  }

  /** 从会话信息卡打开右侧 Git 面板 */
  function openGitPanel() {
    useRightPanelStore().ensureTab("git");
    void refreshStatus();
  }

  async function checkout(name: string) {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await zen.git.checkout(root, name);
    if (result.ok) {
      branchPickerOpen.value = false;
      feedback.value = i18n.global.t("app.git.switchedTo", { name });
      toast.ok(i18n.global.t("app.git.switchedTo", { name }));
      await Promise.all([refreshStatus(), refreshBranches()]);
    } else {
      feedback.value = result.error ?? i18n.global.t("app.git.switchFailed");
      toast.err(result.error ?? i18n.global.t("app.git.switchFailed"));
    }
    return result;
  }

  async function createBranch(name: string) {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await zen.git.createBranch(root, name);
    if (result.ok) {
      branchPickerOpen.value = false;
      feedback.value = i18n.global.t("app.git.createdAndSwitched", { name });
      toast.ok(i18n.global.t("app.git.createdAndSwitched", { name }));
      await Promise.all([refreshStatus(), refreshBranches()]);
    } else {
      feedback.value = result.error ?? i18n.global.t("app.git.createBranchFailed");
      toast.err(result.error ?? i18n.global.t("app.git.createBranchFailed"));
    }
    return result;
  }

  async function commit(
    message: string,
    filesToCommit: string[],
    options: { push?: boolean; includeUnstaged?: boolean } = {},
  ) {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    opBusy.value = options.push ? "commit-push" : "commit";
    let result: Awaited<ReturnType<typeof zen.git.commit>>;
    try {
      result = await zen.git.commit(root, message, filesToCommit, {
        push: options.push,
        includeUnstaged: options.includeUnstaged ?? true,
        // 空 message 一律允许后端自动生成（AI + 兜底），避免「提交信息不能为空」
        autoMessage: true,
        model: completionModel(),
      });
    } finally {
      opBusy.value = "";
    }
    if (result.ok) {
      feedback.value = options.push
        ? i18n.global.t("app.git.committedAndPushed")
        : i18n.global.t("app.git.committed");
      toast.ok(
        options.push
          ? i18n.global.t("app.git.committedAndPushed")
          : i18n.global.t("app.git.committed"),
      );
      await Promise.all([refreshStatus(), refreshBranches()]);
    } else {
      feedback.value = result.error ?? i18n.global.t("app.git.commitFailed");
      toast.err(result.error ?? i18n.global.t("app.git.commitFailed"));
    }
    return result;
  }

  /** 分批提交：按变更内容自动分组，每批独立 commit；返回批次清单供 UI 反馈 */
  async function commitBatched(paths: string[], options: { push?: boolean } = {}) {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, batches: [], error: i18n.global.t("app.git.noWorkDir") };
    }
    opBusy.value = options.push ? "commit-push" : "commit";
    let result: Awaited<ReturnType<typeof zen.git.commitBatched>>;
    try {
      result = await zen.git.commitBatched(root, paths, {
        push: options.push,
        model: completionModel(),
      });
    } finally {
      opBusy.value = "";
    }
    if (result.ok) {
      const hashes = result.batches.map((batch) => batch.hash).join(" ");
      feedback.value = options.push
        ? i18n.global.t("app.git.batchedPushed", {
            n: result.batches.length,
            hashes,
          })
        : i18n.global.t("app.git.batchedCommitted", {
            n: result.batches.length,
            hashes,
          });
      toast.ok(feedback.value);
    }
    if (!result.ok) {
      toast.err(result.error ?? i18n.global.t("app.git.batchedFailed"));
    }
    await Promise.all([refreshStatus(), refreshBranches()]);
    return result;
  }

  async function push() {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    opBusy.value = "push";
    let result: Awaited<ReturnType<typeof zen.git.push>>;
    try {
      result = await zen.git.push(root);
    } finally {
      opBusy.value = "";
    }
    if (result.ok) {
      feedback.value = i18n.global.t("app.git.pushed");
      toast.ok(i18n.global.t("app.git.pushed"));
      await Promise.all([refreshStatus(), refreshBranches()]);
    } else {
      feedback.value = result.error ?? i18n.global.t("app.git.pushFailed");
      toast.err(result.error ?? i18n.global.t("app.git.pushFailed"));
    }
    return result;
  }

  /** fetch / pull / merge 类结果统一反馈：冲突时提示待解决文件数并刷新状态（变更面板展示冲突文件与合并横幅） */
  function reportSyncResult(result: GitSyncResult, messages: { ok: string; failed: string }) {
    if (result.ok) {
      feedback.value = messages.ok;
      toast.ok(messages.ok);
    } else if (result.conflicts?.length) {
      feedback.value = i18n.global.t("app.git.mergeConflict", { n: result.conflicts.length });
      toast.err(feedback.value);
    } else {
      feedback.value = result.error ?? messages.failed;
      toast.err(feedback.value);
    }
  }

  /** 刷新远端状态（fetch）：不合并，仅更新 ahead/behind 与远端分支 */
  async function fetchRemote() {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await zen.git.fetch(root);
    reportSyncResult(result, {
      ok: i18n.global.t("app.git.fetched"),
      failed: i18n.global.t("app.git.fetchFailed"),
    });
    await Promise.all([refreshStatus(), refreshBranches()]);
    return result;
  }

  /** 拉取并合并上游（无上游时后端给清晰报错；冲突时返回冲突文件列表） */
  async function pull() {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await zen.git.pull(root);
    reportSyncResult(result, {
      ok: i18n.global.t("app.git.pulled"),
      failed: i18n.global.t("app.git.pullFailed"),
    });
    await Promise.all([refreshStatus(), refreshBranches()]);
    return result;
  }

  /** 合并指定分支：冲突时不自动提交，变更面板引导解决 */
  async function merge(branch: string) {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await zen.git.merge(root, branch);
    reportSyncResult(result, {
      ok: i18n.global.t("app.git.merged"),
      failed: i18n.global.t("app.git.mergeFailed"),
    });
    await Promise.all([refreshStatus(), refreshBranches()]);
    return result;
  }

  /** 中止进行中的合并 */
  async function mergeAbort() {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await zen.git.mergeAbort(root);
    if (result.ok) {
      feedback.value = i18n.global.t("app.git.mergeAborted");
      toast.ok(i18n.global.t("app.git.mergeAborted"));
    } else {
      feedback.value = result.error ?? i18n.global.t("app.git.abortMergeFailed");
      toast.err(result.error ?? i18n.global.t("app.git.abortMergeFailed"));
    }
    await refreshStatus();
    return result;
  }

  /** 撤回工作区改动：单文件（传 paths）或全部（不传）；不可恢复，调用方需先二次确认 */
  async function discard(paths?: string[]) {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await zen.git.discard(root, paths);
    if (result.ok) {
      feedback.value = paths?.length
        ? i18n.global.t("app.git.discardedFiles", { n: paths.length })
        : i18n.global.t("app.git.discardedAll");
      toast.ok(feedback.value);
    } else {
      feedback.value = result.error ?? i18n.global.t("app.git.discardFailed");
      toast.err(feedback.value);
    }
    await refreshStatus();
    return result;
  }

  /** 刷新贮藏列表（打开 Popover / 贮藏操作后调用） */
  async function refreshStashes() {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      stashes.value = [];
      return;
    }
    stashesLoading.value = true;
    try {
      stashes.value = await zen.git.stashList(root);
    } finally {
      stashesLoading.value = false;
    }
  }

  /** 贮藏当前变更（-u 含未跟踪文件；message 可选） */
  async function stashPush(message?: string) {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await zen.git.stashPush(root, message);
    if (result.ok) {
      feedback.value = i18n.global.t("app.git.stashed");
      toast.ok(i18n.global.t("app.git.stashed"));
    } else {
      feedback.value = result.error ?? i18n.global.t("app.git.stashFailed");
      toast.err(result.error ?? i18n.global.t("app.git.stashFailed"));
    }
    await Promise.all([refreshStatus(), refreshStashes()]);
    return result;
  }

  /** 应用贮藏：apply 保留条目，pop 应用成功后删除 */
  async function stashApply(index: number, mode: "apply" | "pop" = "apply") {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await zen.git.stashApply(root, index, mode);
    reportSyncResult(result, {
      ok: mode === "pop" ? i18n.global.t("app.git.stashPopped") : i18n.global.t("app.git.stashApplied"),
      failed: i18n.global.t("app.git.stashApplyFailed"),
    });
    await Promise.all([refreshStatus(), refreshStashes()]);
    return result;
  }

  /** 删除指定贮藏 */
  async function stashDrop(index: number) {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await zen.git.stashDrop(root, index);
    if (result.ok) {
      feedback.value = i18n.global.t("app.git.stashDropped");
      toast.ok(i18n.global.t("app.git.stashDropped"));
    } else {
      feedback.value = result.error ?? i18n.global.t("app.git.stashDropFailed");
      toast.err(result.error ?? i18n.global.t("app.git.stashDropFailed"));
    }
    await refreshStashes();
    return result;
  }

  function reset() {
    status.value = null;
    branches.value = { local: [], remote: [] };
    pullRequest.value = null;
    log.value = [];
    selectedPath.value = "";
    diff.value = "";
    diffLoading.value = false;
    commitPanelOpen.value = false;
    branchPickerOpen.value = false;
    feedback.value = "";
    stashes.value = [];
    stashesLoading.value = false;
    diffTabs.value = [];
    activeDiffTab.value = "graph";
  }

  function statusBadge(change: GitFileChange): { text: string; cls: string } {
    const code = change.untracked ? "?" : change.x !== " " ? change.x : change.y;
    if (code === "M") {
      return { text: "M", cls: "text-[var(--color-accent)]" };
    }
    if (code === "A") {
      return { text: "A", cls: "text-[var(--color-add)]" };
    }
    if (code === "D") {
      return { text: "D", cls: "text-[var(--color-del)]" };
    }
    if (code === "U") {
      return { text: "U", cls: "text-[var(--color-blue)]" };
    }
    return { text: code, cls: "text-[var(--color-mut)]" };
  }

  return {
    status,
    branches,
    pullRequest,
    log,
    logLoading,
    selectedPath,
    diff,
    diffLoading,
    loading,
    branchesLoading,
    diffLayout,
    commitPanelOpen,
    branchPickerOpen,
    feedback,
    opBusy,
    stashes,
    stashesLoading,
    files,
    branch,
    totalAdd,
    totalDel,
    hasChanges,
    refreshStatus,
    startStatusWatch,
    stopStatusWatch,
    refreshBranches,
    refreshLog,
    logRef,
    setLogRef,
    selectFile,
    diffTabs,
    activeDiffTab,
    openFileTab,
    closeDiffTab,
    checkout,
    createBranch,
    commit,
    commitBatched,
    push,
    fetchRemote,
    pull,
    merge,
    mergeAbort,
    discard,
    refreshStashes,
    stashPush,
    stashApply,
    stashDrop,
    reset,
    statusBadge,
    cwd,
    completionModel,
    openGitPanel,
  };
});
