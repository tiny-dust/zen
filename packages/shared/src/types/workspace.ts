/** 工作区：绑定目录的「工作区」与不绑定目录的「公共区」统一建模 */
export interface Workspace {
  id: string;
  name: string;
  /** null = 公共区（不绑定目录） */
  path: string | null;
  kind: "workspace" | "common";
  pinned: boolean;
  archived: boolean;
  createdAt: number;
}

export interface SessionRecord {
  id: string;
  title: string;
  /** null = 公共区会话 */
  workspaceId: string | null;
  /** 未发送的输入草稿，切换会话后恢复 */
  draft: string;
  pinned: boolean;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
  /** 会话级模型覆盖；null/空表示跟随全局默认模型 */
  modelProviderId?: string | null;
  modelId?: string | null;
}

/** 侧栏按工作区分组消费：工作区行 + 其下会话列表 */
export interface WorkspaceGroup extends Workspace {
  sessions: SessionRecord[];
}
