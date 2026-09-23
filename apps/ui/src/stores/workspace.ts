import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { SessionRecord, WorkspaceGroup } from "@zen/shared";

const ACTIVE_KEY = "zen.activeWorkspace";
const COLLAPSED_KEY = "zen.collapsedWorkspaces";
const COMMON_ID = "common";
/** 每个项目默认展示的会话条数，超出截断 + 渐隐，其余折叠进「展开显示」 */
const PREVIEW_COUNT = 5;

function loadCollapsed(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_KEY) || "[]");
    return new Set(Array.isArray(raw) ? raw.filter((item) => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

export const useWorkspaceStore = defineStore("workspace", () => {
  const groups = ref<WorkspaceGroup[]>([]);
  const activeId = ref(localStorage.getItem(ACTIVE_KEY) || COMMON_ID);
  const expanded = ref(new Set<string>());
  /** 工作区/公共区整组折叠（隐藏其下会话） */
  const collapsed = ref(loadCollapsed());

  const active = computed(() => groups.value.find((item) => item.id === activeId.value) ?? null);
  const activePath = computed(() => active.value?.path ?? undefined);
  const archivedGroups = computed(() => groups.value.filter((item) => item.archived));

  function setActive(id: string) {
    activeId.value = id;
    localStorage.setItem(ACTIVE_KEY, id);
    // 切到该工作区时自动展开，便于立刻看到会话
    if (collapsed.value.has(id)) {
      toggleCollapsed(id);
    }
  }

  function isCollapsed(id: string) {
    return collapsed.value.has(id);
  }

  function toggleCollapsed(id: string) {
    const next = new Set(collapsed.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    collapsed.value = next;
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  }

  function toggleExpanded(id: string) {
    const next = new Set(expanded.value);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    expanded.value = next;
  }

  /** 未展开时截断列表；展开后全量 */
  function visibleSessions(group: WorkspaceGroup) {
    if (expanded.value.has(group.id)) {
      return group.sessions;
    }
    return group.sessions.slice(0, PREVIEW_COUNT);
  }

  function pathOf(id: string | null | undefined): string | undefined {
    if (!id || id === COMMON_ID) {
      return undefined;
    }
    return groups.value.find((item) => item.id === id)?.path ?? undefined;
  }

  /** 新会话就地插到对应分组顶部，免去整体刷新 */
  function appendSessionLocal(workspaceId: string, record: SessionRecord) {
    const group = groups.value.find((item) => item.id === workspaceId);
    if (group) {
      group.sessions.unshift(record);
    }
  }

  function renameSessionLocal(sessionId: string, title: string) {
    for (const group of groups.value) {
      const session = group.sessions.find((item) => item.id === sessionId);
      if (session) {
        session.title = title;
        return;
      }
    }
  }

  /** 置顶状态变更后重排：置顶优先，其余按更新时间 */
  function pinSessionLocal(sessionId: string, pinned: boolean) {
    for (const group of groups.value) {
      const session = group.sessions.find((item) => item.id === sessionId);
      if (session) {
        session.pinned = pinned;
        group.sessions.sort(
          (a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
        );
        return;
      }
    }
  }

  function archiveSessionLocal(sessionId: string, archived: boolean) {
    for (const group of groups.value) {
      const session = group.sessions.find((item) => item.id === sessionId);
      if (session) {
        session.archived = archived;
        return;
      }
    }
  }

  function removeSessionLocal(sessionId: string) {
    for (const group of groups.value) {
      const index = group.sessions.findIndex((item) => item.id === sessionId);
      if (index >= 0) {
        group.sessions.splice(index, 1);
        return;
      }
    }
  }

  async function refresh() {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    groups.value = await zen.workspace.list();
    const exists = groups.value.some((item) => item.id === activeId.value && !item.archived);
    if (!exists) {
      const fallback =
        groups.value.find((item) => !item.archived && item.kind === "workspace") ??
        groups.value.find((item) => item.id === COMMON_ID);
      setActive(fallback ? fallback.id : COMMON_ID);
    }
  }

  async function create(): Promise<boolean> {
    const zen = window.zen;
    if (!zen) {
      return false;
    }
    // 主进程侧失败（如系统弹窗被压制、IPC reject）时不能静默吞掉，至少留下错误日志
    let workspace: Awaited<ReturnType<typeof zen.workspace.create>>;
    try {
      workspace = await zen.workspace.create();
    } catch (error) {
      console.error("[workspace] create failed:", error);
      return false;
    }
    if (!workspace) {
      return false;
    }
    await refresh();
    setActive(workspace.id);
    return true;
  }

  async function pin(id: string, pinned: boolean) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    groups.value = await zen.workspace.pin(id, pinned);
  }

  /** 工作区重命名（右键菜单）：只改侧栏显示名 */
  async function rename(id: string, name: string) {
    const zen = window.zen;
    if (!zen || !name.trim()) {
      return;
    }
    groups.value = await zen.workspace.rename(id, name.trim());
  }

  async function archive(id: string, archived: boolean) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    groups.value = await zen.workspace.archive(id, archived);
    if (archived && activeId.value === id) {
      setActive(COMMON_ID);
    }
  }

  async function remove(id: string) {
    const zen = window.zen;
    if (!zen) {
      return;
    }
    groups.value = await zen.workspace.remove(id);
    if (activeId.value === id) {
      setActive(COMMON_ID);
    }
  }

  return {
    groups,
    activeId,
    active,
    activePath,
    archivedGroups,
    expanded,
    collapsed,
    COMMON_ID,
    PREVIEW_COUNT,
    setActive,
    isCollapsed,
    toggleCollapsed,
    toggleExpanded,
    visibleSessions,
    pathOf,
    appendSessionLocal,
    renameSessionLocal,
    pinSessionLocal,
    archiveSessionLocal,
    removeSessionLocal,
    refresh,
    create,
    pin,
    rename,
    archive,
    remove,
  };
});
