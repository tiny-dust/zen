import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { SessionRecord, WorkspaceGroup } from "@zen/shared";

const ACTIVE_KEY = "zen.activeWorkspace";
const COMMON_ID = "common";
/** 每个工作区默认展示的会话条数，其余折叠进「展开显示」 */
const PREVIEW_COUNT = 3;

export const useWorkspaceStore = defineStore("workspace", () => {
  const groups = ref<WorkspaceGroup[]>([]);
  const activeId = ref(localStorage.getItem(ACTIVE_KEY) || COMMON_ID);
  const expanded = ref(new Set<string>());

  const active = computed(() => groups.value.find((item) => item.id === activeId.value) ?? null);
  const activePath = computed(() => active.value?.path ?? undefined);
  const archivedGroups = computed(() => groups.value.filter((item) => item.archived));

  function setActive(id: string) {
    activeId.value = id;
    localStorage.setItem(ACTIVE_KEY, id);
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
    const workspace = await zen.workspace.create();
    if (!workspace) {
      return false;
    }
    await refresh();
    setActive(workspace.id);
    return true;
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
    COMMON_ID,
    PREVIEW_COUNT,
    setActive,
    toggleExpanded,
    visibleSessions,
    pathOf,
    appendSessionLocal,
    renameSessionLocal,
    refresh,
    create,
    archive,
    remove,
  };
});
