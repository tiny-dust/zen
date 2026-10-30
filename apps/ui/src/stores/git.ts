import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";

import type {
  GitBranchInfo,
  GitBranches,
  GitFileChange,
  GitLogEntry,
  GitPullRequest,
  GitRepository,
  GitStashEntry,
  GitStatus,
  GitSyncResult,
} from "@zen/shared";
import { toast } from "@/components/ui/toast";
import { useChatStore } from "@/stores/chat";
import { useRightPanelStore } from "@/stores/right-panel";
import { useSessionWorktreeStore } from "@/stores/session-worktree";
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

  /** 目录内独立仓库；选择按会话及其实际工作目录保存，避免工作树间串仓库。 */
  const repositories = ref<GitRepository[]>([]);
  const repositoriesLoading = ref(false);
  const repositoryError = ref("");
  const repositoryBranches = ref<Record<string, string>>({});
  const selectedRepositoryPath = ref("");
  const selectedScopeKey = ref("");
  const selectionByScope = new Map<string, string>();
  const mutationCount = ref(0);
  const mutationBusy = computed(() => mutationCount.value > 0 || !!opBusy.value);
  let discovery: { key: string; promise: Promise<void> } | null = null;
  let summaryGeneration = 0;

  async function runMutation<T>(action: () => Promise<T>): Promise<T> {
    mutationCount.value += 1;
    try {
      return await action();
    } finally {
      mutationCount.value -= 1;
    }
  }

  function reportReadError(error: unknown, key: string, root: string) {
    if (scopeKey.value === key && cwd() === root) {
      repositoryError.value = error instanceof Error ? error.message : String(error);
    }
  }

  function directoryScope() {
    const chat = useChatStore();
    const localPath = useWorkspaceStore().pathOf(chat.sessionWorkspaceId);
    const root = useSessionWorktreeStore().cwd(chat.sessionId, localPath);
    return { key: `${chat.sessionId}\0${root ?? ""}`, root };
  }

  const scopeKey = computed(() => directoryScope().key);

  function cwd(): string | undefined {
    return selectedScopeKey.value === scopeKey.value
      && repositories.value.some((repo) => repo.path === selectedRepositoryPath.value)
      ? selectedRepositoryPath.value
      : undefined;
  }

  async function loadRepositoryBranches(found: GitRepository[], key: string, generation: number) {
    const zen = window.zen;
    if (!zen?.git) return;
    // 只读分支摘要，避免对每个仓库运行昂贵的文件状态扫描。
    const workers = Array.from({ length: Math.min(4, found.length) }, async (_, index) => {
      for (let i = index; i < found.length; i += 4) {
        const repo = found[i];
        if (!repo) continue;
        try {
          const info = await zen.git.info(repo.path);
          if (scopeKey.value === key && summaryGeneration === generation) {
            const branch = repo.path === cwd() && status.value?.branch
              ? status.value.branch
              : info.branch;
            repositoryBranches.value = { ...repositoryBranches.value, [repo.path]: branch };
          }
        } catch {
          // 单仓库消失或权限不足时仍展示路径，其余仓库继续可用。
        }
      }
    });
    await Promise.all(workers);
  }

  async function refreshRepositories(): Promise<void> {
    const zen = window.zen;
    const { key, root } = directoryScope();
    if (!zen?.git?.discover || !root) {
      repositories.value = [];
      repositoriesLoading.value = false;
      selectedRepositoryPath.value = "";
      selectedScopeKey.value = "";
      repositoryBranches.value = {};
      reset();
      return;
    }
    if (discovery?.key === key) return discovery.promise;
    repositoriesLoading.value = true;
    repositoryError.value = "";
    const promise = (async () => {
      try {
        const found = await zen.git.discover(root);
        if (scopeKey.value !== key) return;
        repositories.value = found;
        const preferred = selectionByScope.get(key);
        const selected = found.find((repo) => repo.path === preferred)
          ?? found.find((repo) => repo.relativePath === ".")
          ?? found[0];
        const changed = selectedRepositoryPath.value !== (selected?.path ?? "");
        if (changed) reset();
        selectedRepositoryPath.value = selected?.path ?? "";
        selectedScopeKey.value = key;
        if (selected) selectionByScope.set(key, selected.path);
        repositoryBranches.value = {};
        void loadRepositoryBranches(found, key, ++summaryGeneration);
        if (changed && selected) {
          void Promise.all([refreshStatus(), refreshBranches(), refreshLog(), refreshStashes()]);
        }
      } catch (error) {
        if (scopeKey.value !== key) return;
        repositories.value = [];
        selectedRepositoryPath.value = "";
        selectedScopeKey.value = "";
        repositoryError.value = error instanceof Error ? error.message : String(error);
        reset();
      } finally {
        if (scopeKey.value === key) repositoriesLoading.value = false;
      }
    })();
    discovery = { key, promise };
    try {
      await promise;
    } finally {
      if (discovery?.promise === promise) discovery = null;
    }
  }

  async function resolvedCwd(): Promise<string | undefined> {
    if (!cwd() && directoryScope().root) await refreshRepositories();
    return cwd();
  }

  async function selectRepository(path: string): Promise<void> {
    if (mutationBusy.value || !repositories.value.some((repo) => repo.path === path)) return;
    if (selectedRepositoryPath.value === path) return;
    selectedRepositoryPath.value = path;
    selectedScopeKey.value = scopeKey.value;
    selectionByScope.set(scopeKey.value, path);
    reset();
    await Promise.all([refreshStatus(), refreshBranches(), refreshLog(), refreshStashes()]);
  }

  /** commit AI 生成用的模型：当前会话生效模型（会话覆盖 > 全局默认）。
   *  全局兜底会按名称排序取第一个启用模型（当前是 glm-5.3 这类推理模型）：
   *  completeOnce 已对补全任务自动降最低推理档 + 放宽超时，仍显式传会话模型保持确定性 */
  function completionModel(): { providerId?: string; modelId?: string } {
    const sel = useChatStore().effectiveSelection;
    return sel.providerId && sel.modelId
      ? { providerId: sel.providerId, modelId: sel.modelId }
      : {};
  }

  const files = computed(() => status.value?.files ?? []);
  const branch = computed(() => status.value?.branch ?? "");
  const totalAdd = computed(() => files.value.reduce((sum, item) => sum + item.add, 0));
  const totalDel = computed(() => files.value.reduce((sum, item) => sum + item.del, 0));
  const hasChanges = computed(() => files.value.length > 0);

  /** 父仓库的 porcelain 会把独立子仓库记作 `?? child/`；只在该子仓库自己的视图展示。 */
  function withoutNestedRepositories(next: GitStatus, root: string): GitStatus {
    const parent = root.replace(/\\/g, "/").replace(/\/+$/, "");
    const nestedPaths = repositories.value
      .map((repo) => repo.path.replace(/\\/g, "/"))
      .filter((path) => path.startsWith(`${parent}/`))
      .map((path) => path.slice(parent.length + 1).replace(/\/+$/, ""));
    if (!nestedPaths.length) return next;
    return {
      ...next,
      files: next.files.filter((file) => {
        const path = file.path.replace(/\\/g, "/").replace(/\/+$/, "");
        return !nestedPaths.some((nested) => path === nested || path.startsWith(`${nested}/`));
      }),
    };
  }

  /** 应用一次 status 结果：更新文件列表并校正 tab/diff、同步 chat 分支信息 */
  function applyStatus(next: GitStatus | null) {
    const root = cwd();
    status.value = next && root ? withoutNestedRepositories(next, root) : next;
    if (next && selectedRepositoryPath.value) {
      repositoryBranches.value = {
        ...repositoryBranches.value,
        [selectedRepositoryPath.value]: next.branch,
      };
    }
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
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      applyStatus(null);
      return;
    }
    const key = scopeKey.value;
    loading.value = true;
    try {
      const next = await zen.git.status(root);
      if (scopeKey.value === key && cwd() === root) {
        repositoryError.value = "";
        applyStatus(next);
      }
    } catch (error) {
      if (scopeKey.value === key && cwd() === root) {
        repositoryError.value = error instanceof Error ? error.message : String(error);
      }
    } finally {
      if (scopeKey.value === key && cwd() === root) loading.value = false;
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
    const key = scopeKey.value;
    try {
      const next = await zen.git.status(root);
      if (scopeKey.value !== key || cwd() !== root) return;
      const scoped = next ? withoutNestedRepositories(next, root) : null;
      if (JSON.stringify(scoped) === JSON.stringify(status.value)) {
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
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      branches.value = { local: [], remote: [] };
      pullRequest.value = null;
      return;
    }
    const key = scopeKey.value;
    branchesLoading.value = true;
    try {
      const [nextBranches, nextPr] = await Promise.all([zen.git.branches(root), zen.git.pr(root)]);
      if (scopeKey.value === key && cwd() === root) {
        branches.value = nextBranches;
        pullRequest.value = nextPr;
      }
    } catch (error) {
      reportReadError(error, key, root);
    } finally {
      if (scopeKey.value === key && cwd() === root) branchesLoading.value = false;
    }
  }

  /** 图谱分支筛选："" = 全部分支（--all），否则按指定 ref 取历史 */
  const logRef = ref("");
  /** 提交历史（图谱视图数据源） */
  async function refreshLog() {
    const zen = window.zen;
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      log.value = [];
      return;
    }
    const key = scopeKey.value;
    logLoading.value = true;
    try {
      const next = await zen.git.log(root, logRef.value || undefined);
      if (scopeKey.value === key && cwd() === root) log.value = next;
    } catch (error) {
      reportReadError(error, key, root);
    } finally {
      if (scopeKey.value === key && cwd() === root) logLoading.value = false;
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
    const zen = window.zen;
    const root = await resolvedCwd();
    selectedPath.value = path;
    if (!zen?.git || !root) {
      diff.value = "";
      return;
    }
    const key = scopeKey.value;
    diffLoading.value = true;
    try {
      const change = files.value.find((item) => item.path === path);
      if (change?.untracked) {
        const content = await zen.workspace.readFile(root, path);
        if (scopeKey.value === key && cwd() === root && selectedPath.value === path) {
          diff.value = content ? toAddedDiff(path, content.content) : `Binary files ${path} differ`;
        }
        return;
      }
      let raw = await zen.git.diff(root, path);
      if (!raw) {
        // 仅已暂存的文件没有 unstaged diff，回落到 staged diff
        raw = await zen.git.diff(root, path, true);
      }
      if (scopeKey.value === key && cwd() === root && selectedPath.value === path) diff.value = raw ?? "";
    } catch (error) {
      reportReadError(error, key, root);
    } finally {
      if (scopeKey.value === key && cwd() === root && selectedPath.value === path) diffLoading.value = false;
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
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await runMutation(() => zen.git.checkout(root, name));
    if (cwd() !== root) return result;
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

  async function createBranch(name: string, base?: string) {
    const zen = window.zen;
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await runMutation(() => zen.git.createBranch(root, name, base));
    if (cwd() !== root) return result;
    if (result.ok) {
      branchPickerOpen.value = false;
      feedback.value = base
        ? i18n.global.t("shell.createdBranchFrom", { from: base, name })
        : i18n.global.t("app.git.createdAndSwitched", { name });
      toast.ok(feedback.value);
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
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    if (!filesToCommit.length) {
      return { ok: false, error: i18n.global.t("panels.noChanges") };
    }
    opBusy.value = options.push ? "commit-push" : "commit";
    let result: Awaited<ReturnType<typeof zen.git.commit>>;
    try {
      result = await runMutation(() => zen.git.commit(root, message, filesToCommit, {
        push: options.push,
        includeUnstaged: options.includeUnstaged ?? true,
        // 空 message 一律允许后端自动生成（AI + 兜底），避免「提交信息不能为空」
        autoMessage: true,
        model: completionModel(),
      }));
    } finally {
      opBusy.value = "";
    }
    if (cwd() !== root) return result;
    if (result.ok) {
      const base = options.push
        ? i18n.global.t("app.git.committedAndPushed")
        : i18n.global.t("app.git.committed");
      // AI 生成失败走了兜底时，提示里带出原因，避免「为什么又变成 chore」无处排查
      feedback.value = result.aiNote
        ? `${base}（${i18n.global.t("app.git.aiFallbackNote", { reason: result.aiNote })}）`
        : base;
      toast.ok(feedback.value);
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
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      return { ok: false, batches: [], error: i18n.global.t("app.git.noWorkDir") };
    }
    if (!paths.length) {
      return { ok: false, batches: [], error: i18n.global.t("panels.noChanges") };
    }
    opBusy.value = options.push ? "commit-push" : "commit";
    let result: Awaited<ReturnType<typeof zen.git.commitBatched>>;
    try {
      result = await runMutation(() => zen.git.commitBatched(root, paths, {
        push: options.push,
        model: completionModel(),
      }));
    } finally {
      opBusy.value = "";
    }
    if (cwd() !== root) return result;
    if (result.ok) {
      const hashes = result.batches.map((batch) => batch.hash).join(" ");
      const base = options.push
        ? i18n.global.t("app.git.batchedPushed", {
            n: result.batches.length,
            hashes,
          })
        : i18n.global.t("app.git.batchedCommitted", {
            n: result.batches.length,
            hashes,
          });
      // AI 规划失败走了目录兜底时，提示里带出原因，避免批次全是 chore: update 却不知为何
      feedback.value = result.planNote
        ? `${base}（${i18n.global.t("app.git.aiFallbackNote", { reason: result.planNote })}）`
        : base;
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
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    opBusy.value = "push";
    let result: Awaited<ReturnType<typeof zen.git.push>>;
    try {
      result = await runMutation(() => zen.git.push(root));
    } finally {
      opBusy.value = "";
    }
    if (cwd() !== root) return result;
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
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await runMutation(() => zen.git.fetch(root));
    if (cwd() !== root) return result;
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
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await runMutation(() => zen.git.pull(root));
    if (cwd() !== root) return result;
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
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await runMutation(() => zen.git.merge(root, branch));
    if (cwd() !== root) return result;
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
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await runMutation(() => zen.git.mergeAbort(root));
    if (cwd() !== root) return result;
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
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await runMutation(() => zen.git.discard(root, paths));
    if (cwd() !== root) return result;
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
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      stashes.value = [];
      return;
    }
    const key = scopeKey.value;
    stashesLoading.value = true;
    try {
      const next = await zen.git.stashList(root);
      if (scopeKey.value === key && cwd() === root) stashes.value = next;
    } catch (error) {
      reportReadError(error, key, root);
    } finally {
      if (scopeKey.value === key && cwd() === root) stashesLoading.value = false;
    }
  }

  /** 贮藏当前变更（-u 含未跟踪文件；message 可选） */
  async function stashPush(message?: string) {
    const zen = window.zen;
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await runMutation(() => zen.git.stashPush(root, message));
    if (cwd() !== root) return result;
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
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await runMutation(() => zen.git.stashApply(root, index, mode));
    if (cwd() !== root) return result;
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
    const root = await resolvedCwd();
    if (!zen?.git || !root) {
      return { ok: false, error: i18n.global.t("app.git.noWorkDir") };
    }
    const result = await runMutation(() => zen.git.stashDrop(root, index));
    if (cwd() !== root) return result;
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
    loading.value = false;
    branches.value = { local: [], remote: [] };
    branchesLoading.value = false;
    pullRequest.value = null;
    log.value = [];
    logLoading.value = false;
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
    logRef.value = "";
  }

  watch(scopeKey, () => {
    repositories.value = [];
    repositoriesLoading.value = false;
    selectedRepositoryPath.value = "";
    selectedScopeKey.value = "";
    repositoryBranches.value = {};
    repositoryError.value = "";
    reset();
    void refreshRepositories();
  }, { immediate: true });

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
    repositories,
    repositoriesLoading,
    repositoryError,
    repositoryBranches,
    selectedRepositoryPath,
    mutationBusy,
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
    refreshRepositories,
    selectRepository,
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
