import type { CliRuntimeId } from "./cli-runtime";
import type { SessionGoal } from "./session-goal";
import type { SessionMode } from "./session-mode";

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
  /** Plan / Act 的显式模型；null 表示沿用自动路由或会话默认模型 */
  planModelProviderId?: string | null;
  planModelId?: string | null;
  actModelProviderId?: string | null;
  actModelId?: string | null;
  /**
   * P/A 双模型模式（会话级）：开启后每轮先由 Plan 模型出计划、再由 Act 模型执行；
   * 关闭时只用会话模型，阶段模型配置保留但暂不生效。与「计划模式」相互独立。
   */
  pairMode?: boolean;
  /** 会话模式（interactive/plan/autopilot）；旧数据缺省按 interactive 处理 */
  mode?: SessionMode;
  /** 会话目标（Goals 目标模式）；null/缺省 = 未设定目标 */
  goal?: SessionGoal | null;
  /** 会话底座：外部 CLI；null/缺省 = 走 API 模型（旧会话一律 API 路径） */
  runtimeCli?: CliRuntimeId | null;
}

/** 一个会话独占的 Git worktree；path 是该项目在工作树内的实际工作目录。 */
export interface SessionWorktree {
  sessionId: string;
  projectPath: string;
  repoPath: string;
  worktreePath: string;
  path: string;
  branch: string;
  createdAt: number;
}

/** 侧栏按工作区分组消费：工作区行 + 其下会话列表 */
export interface WorkspaceGroup extends Workspace {
  sessions: SessionRecord[];
}
