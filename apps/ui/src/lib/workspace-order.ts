import type { SessionRecord, WorkspaceGroup } from "@zen/shared";

/** 分组最近活动时间：取组内未归档会话的最大 updatedAt，没有会话则回落到组建时间 */
export function groupActivityAt(group: WorkspaceGroup): number {
  let latest = 0;
  for (const session of group.sessions) {
    if (session.archived) continue;
    latest = Math.max(latest, session.updatedAt ?? 0);
  }
  return latest || group.createdAt;
}

/**
 * 侧栏外层排序：置顶分组恒在前；其余按最近活动倒序（哪个目录刚有对话就浮到顶部）。
 * 活动时间相同再按创建时间，保证顺序稳定。
 */
export function sortGroupsByActivity(groups: WorkspaceGroup[]): WorkspaceGroup[] {
  return [...groups].sort((a, b) => {
    if (!!a.pinned !== !!b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return groupActivityAt(b) - groupActivityAt(a) || a.createdAt - b.createdAt;
  });
}

/** 组内会话排序：置顶优先，其余按最近更新时间倒序（与后端 ORDER BY 一致） */
export function sortSessionsByActivity(sessions: SessionRecord[]): SessionRecord[] {
  return [...sessions].sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });
}
