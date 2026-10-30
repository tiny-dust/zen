import { defineStore } from "pinia";
import { ref } from "vue";

import type { SessionWorktree } from "@zen/shared";

/** Worktree 绑定属于会话，不随当前工作区或右栏标签切换而共享。 */
export const useSessionWorktreeStore = defineStore("session-worktree", () => {
  const bySessionId = ref<Record<string, SessionWorktree | null>>({});
  const busyId = ref("");
  const revisionById = new Map<string, number>();

  function current(id: string): SessionWorktree | null {
    return bySessionId.value[id] ?? null;
  }

  function cwd(id: string, localPath: string | undefined): string | undefined {
    return current(id)?.path ?? localPath;
  }

  function nextRevision(id: string): number {
    const revision = (revisionById.get(id) ?? 0) + 1;
    revisionById.set(id, revision);
    return revision;
  }

  async function load(id: string): Promise<void> {
    if (!id || !window.zen?.session?.worktree) return;
    const revision = nextRevision(id);
    const worktree = await window.zen.session.worktree(id);
    if (revisionById.get(id) === revision) {
      bySessionId.value = { ...bySessionId.value, [id]: worktree };
    }
  }

  async function create(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!id || !window.zen?.session?.createWorktree || busyId.value) {
      return { ok: false };
    }
    busyId.value = id;
    const revision = nextRevision(id);
    try {
      const result = await window.zen.session.createWorktree(id);
      if (result.ok && result.worktree && revisionById.get(id) === revision) {
        bySessionId.value = { ...bySessionId.value, [id]: result.worktree };
      }
      return result;
    } finally {
      busyId.value = "";
    }
  }

  async function remove(id: string): Promise<{ ok: boolean; error?: string }> {
    if (!id || !window.zen?.session?.removeWorktree || busyId.value) {
      return { ok: false };
    }
    busyId.value = id;
    const revision = nextRevision(id);
    try {
      const result = await window.zen.session.removeWorktree(id);
      if (result.ok && revisionById.get(id) === revision) {
        bySessionId.value = { ...bySessionId.value, [id]: null };
      }
      return result;
    } finally {
      busyId.value = "";
    }
  }

  return { bySessionId, busyId, current, cwd, load, create, remove };
});
