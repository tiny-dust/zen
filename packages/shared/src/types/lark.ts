/**
 * 飞书集成：通过本机已登录的 lark-cli（当前账户的飞书应用）实现
 * - bot 私信查询 zen 会话列表与运行状态
 * - 会话 askUser 问询推送到飞书，回复写回会话
 */

/** 会话在飞书侧展示的运行状态 */
export type LarkSessionState =
  | "idle"
  | "running"
  | "waiting-approval"
  | "waiting-ask"
  | "paused";

/** 飞书网关（事件监听进程）状态 */
export type LarkGatewayState = "off" | "starting" | "ready" | "error";

/** lark-cli 登录态（auth status 的可展示字段，不含任何 token） */
export interface LarkAuthSnapshot {
  /** 本机是否找到可执行的 lark-cli */
  available: boolean;
  /** lark-cli 版本（未解析到为 null） */
  version: string | null;
  appId: string | null;
  /** feishu / lark */
  brand: string | null;
  /** bot 身份是否可用（发消息走 bot） */
  botReady: boolean;
  /** 当前登录用户 open_id（未登录为 null） */
  userOpenId: string | null;
  /** 当前登录用户姓名（缺失为 null） */
  userName: string | null;
  /** 不可用原因（available=false 时给出；探测成功为 null/缺省） */
  error?: string | null;
}

/** 飞书集成设置（持久化在 AgentSettings.larkBridge） */
export interface LarkBridgeSettings {
  /** 启用后：监听飞书消息指令 + 推送问询 */
  enabled: boolean;
  /** 允许操控 zen 的飞书用户 open_id（非该用户发的消息一律忽略） */
  allowedOpenId: string | null;
}

export const DEFAULT_LARK_BRIDGE_SETTINGS: LarkBridgeSettings = {
  enabled: false,
  allowedOpenId: null,
};

/** lark:status 返回的整体快照 */
export interface LarkStatus {
  auth: LarkAuthSnapshot;
  gateway: LarkGatewayState;
  /** 网关 error 态的原因（可空） */
  gatewayError: string | null;
  settings: LarkBridgeSettings;
}

/** 飞书侧展示的会话摘要（查询指令的回复内容） */
export interface LarkSessionSummary {
  id: string;
  title: string;
  state: LarkSessionState;
  updatedAt: number;
}
