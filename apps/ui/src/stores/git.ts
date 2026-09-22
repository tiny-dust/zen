import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type {
  GitBranchInfo,
  GitBranches,
  GitFileChange,
  GitLogEntry,
  GitPullRequest,
  GitStatus,
} from "@zen/shared";
import { toast } from "@/components/ui/toast";
import { useChatStore } from "@/stores/chat";
import { useRightPanelStore } from "@/stores/right-panel";
import { useWorkspaceStore } from "@/stores/workspace";

export type DiffLayout = "single" | "double";

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

  function cwd(): string | undefined {
    return useWorkspaceStore().pathOf(useChatStore().sessionWorkspaceId);
  }

  const files = computed(() => status.value?.files ?? []);
  const branch = computed(() => status.value?.branch || useChatStore().branch);
  const totalAdd = computed(() => files.value.reduce((sum, item) => sum + item.add, 0));
  const totalDel = computed(() => files.value.reduce((sum, item) => sum + item.del, 0));
  const hasChanges = computed(() => files.value.length > 0);

  /** 应用一次 status 结果：更新文件列表并校正选中/diff、同步 chat 分支信息 */
  function applyStatus(next: GitStatus | null) {
    status.value = next;
    const valid = new Set(files.value.map((item) => item.path));
    if (selectedPath.value && !valid.has(selectedPath.value)) {
      selectedPath.value = "";
      diff.value = "";
    }
    if (!selectedPath.value && files.value.length) {
      void selectFile(files.value[0].path);
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

  /** 从会话信息卡打开右侧变更面板 */
  function openChangesPanel() {
    useRightPanelStore().ensureTab("changes");
    void refreshStatus();
  }

  async function checkout(name: string) {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: "未绑定工作目录" };
    }
    const result = await zen.git.checkout(root, name);
    if (result.ok) {
      branchPickerOpen.value = false;
      feedback.value = `已切换到 ${name}`;
      toast.ok(`已切换到 ${name}`);
      await Promise.all([refreshStatus(), refreshBranches()]);
    } else {
      feedback.value = result.error ?? "切换分支失败";
      toast.err(result.error ?? "切换分支失败");
    }
    return result;
  }

  async function createBranch(name: string) {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: "未绑定工作目录" };
    }
    const result = await zen.git.createBranch(root, name);
    if (result.ok) {
      branchPickerOpen.value = false;
      feedback.value = `已创建并切换到 ${name}`;
      toast.ok(`已创建并切换到 ${name}`);
      await Promise.all([refreshStatus(), refreshBranches()]);
    } else {
      feedback.value = result.error ?? "创建分支失败";
      toast.err(result.error ?? "创建分支失败");
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
      return { ok: false, error: "未绑定工作目录" };
    }
    const result = await zen.git.commit(root, message, filesToCommit, {
      push: options.push,
      includeUnstaged: options.includeUnstaged ?? true,
      // 空 message 一律允许后端自动生成（AI + 兜底），避免「提交信息不能为空」
      autoMessage: true,
    });
    if (result.ok) {
      feedback.value = options.push ? "已提交并推送" : "已提交";
      toast.ok(options.push ? "已提交并推送" : "已提交");
      await Promise.all([refreshStatus(), refreshBranches()]);
    } else {
      feedback.value = result.error ?? "提交失败";
      toast.err(result.error ?? "提交失败");
    }
    return result;
  }

  /** 分批提交：按变更内容自动分组，每批独立 commit；返回批次清单供 UI 反馈 */
  async function commitBatched(paths: string[], options: { push?: boolean } = {}) {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, batches: [], error: "未绑定工作目录" };
    }
    const result = await zen.git.commitBatched(root, paths, { push: options.push });
    if (result.ok) {
      const hashes = result.batches.map((batch) => batch.hash).join(" ");
      feedback.value = options.push
        ? `已分 ${result.batches.length} 批提交并推送（${hashes}）`
        : `已分 ${result.batches.length} 批提交（${hashes}）`;
      toast.ok(feedback.value);
    }
    if (!result.ok) {
      toast.err(result.error ?? "分批提交失败");
    }
    await Promise.all([refreshStatus(), refreshBranches()]);
    return result;
  }

  async function push() {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return { ok: false, error: "未绑定工作目录" };
    }
    const result = await zen.git.push(root);
    if (result.ok) {
      feedback.value = "已推送";
      toast.ok("已推送");
      await Promise.all([refreshStatus(), refreshBranches()]);
    } else {
      feedback.value = result.error ?? "推送失败";
      toast.err(result.error ?? "推送失败");
    }
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
    checkout,
    createBranch,
    commit,
    commitBatched,
    push,
    reset,
    statusBadge,
    cwd,
    openChangesPanel,
  };
});
