import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type {
  GitBranchInfo,
  GitBranches,
  GitFileChange,
  GitPullRequest,
  GitStatus,
} from "@zen/shared";
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
  const loading = ref(false);
  const branchesLoading = ref(false);
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

  async function refreshStatus() {
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      status.value = null;
      return;
    }
    loading.value = true;
    try {
      status.value = await zen.git.status(root);
      const valid = new Set(files.value.map((item) => item.path));
      if (selectedPath.value && !valid.has(selectedPath.value)) {
        selectedPath.value = "";
        diff.value = "";
      }
      if (!selectedPath.value && files.value.length) {
        void selectFile(files.value[0].path);
      }
      void useChatStore().refreshGit();
    } finally {
      loading.value = false;
    }
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

  async function selectFile(path: string) {
    selectedPath.value = path;
    const zen = window.zen;
    const root = cwd();
    if (!zen?.git || !root) {
      return;
    }
    diff.value = (await zen.git.diff(root, path)) ?? "（无未暂存 diff）";
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
      await Promise.all([refreshStatus(), refreshBranches()]);
    } else {
      feedback.value = result.error ?? "切换分支失败";
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
      await Promise.all([refreshStatus(), refreshBranches()]);
    } else {
      feedback.value = result.error ?? "创建分支失败";
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
      await Promise.all([refreshStatus(), refreshBranches()]);
    } else {
      feedback.value = result.error ?? "提交失败";
    }
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
      await Promise.all([refreshStatus(), refreshBranches()]);
    } else {
      feedback.value = result.error ?? "推送失败";
    }
    return result;
  }

  function reset() {
    status.value = null;
    branches.value = { local: [], remote: [] };
    pullRequest.value = null;
    selectedPath.value = "";
    diff.value = "";
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
    selectedPath,
    diff,
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
    refreshBranches,
    selectFile,
    checkout,
    createBranch,
    commit,
    push,
    reset,
    statusBadge,
    cwd,
    openChangesPanel,
  };
});
