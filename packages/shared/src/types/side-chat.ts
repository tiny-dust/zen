/**
 * 侧边对话：挂在某个主会话旁边、独立落库的对话。
 * 与主会话互不影响（自己的消息、草稿、模型），关闭标签只关闭视图，重启后可继续。
 */

export interface SideChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  /** 这一轮失败的原因；有值时界面显示错误气泡而不是空回复 */
  error?: string;
}

export interface SideChatModelRef {
  providerId: string;
  modelId: string;
}

export interface SideChatRecord {
  id: string;
  /** 挂靠的主会话；切换主会话后仍属于原会话 */
  sessionId: string;
  workspaceId: string;
  /** 展示名：侧边对话 N（按 seq） */
  title: string;
  seq: number;
  messages: SideChatMessage[];
  /** 未提交的输入文本（换会话/重启后恢复） */
  draft: string;
  model: SideChatModelRef | null;
  effort: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SideChatListResult {
  chats: SideChatRecord[];
}

/** 侧聊续写的流事件（主进程 → 渲染层） */
export type SideChatStreamEvent =
  | { id: string; type: "delta"; text: string }
  | { id: string; type: "done"; message: SideChatMessage }
  | { id: string; type: "error"; error: string }
  | { id: string; type: "stopped" };
