/** 工作区：绑定目录的「工作区」与不绑定目录的「公共区」统一建模 */
export interface Workspace {
  id: string;
  name: string;
  /** null = 公共区（不绑定目录） */
  path: string | null;
  kind: "workspace" | "common";
  archived: boolean;
  createdAt: number;
}

export interface SessionRecord {
  id: string;
  title: string;
  /** null = 公共区会话 */
  workspaceId: string | null;
  createdAt: number;
  updatedAt: number;
}

/** 侧栏按工作区分组消费：工作区行 + 其下会话列表 */
export interface WorkspaceGroup extends Workspace {
  sessions: SessionRecord[];
}
