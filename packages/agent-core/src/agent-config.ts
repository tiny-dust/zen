import { multiAgentInstructions } from "./multi-agent-instructions";

import type {
  AgentStreamEvent,
  BrowserAgentBridge,
  PermissionMode,
  ProviderProtocol,
  ReasoningEffort,
} from "@zen/shared";

export interface AgentSkillHint {
  id: string;
  name: string;
  description: string;
}

/** MCP 工具桥接描述（main 侧由 McpToolInfo + server 配置转换而来） */
export interface McpToolBridge {
  serverName: string;
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** 记忆桥（main 侧落盘 ~/.zen/memory；scope 区分设备环境 / 用户习惯） */
export interface MemoryAgentBridge {
  appendNote(
    scope: "device" | "user",
    text: string,
  ): Promise<{ ok: boolean; error?: string }>;
}

export interface AgentSessionConfig {
  sessionId: string;
  workspaceRoot: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  /** 权限模式（ADR-004）：default / smart / full */
  permissionMode: PermissionMode;
  /** 系统提示词全文（设置页选择的预设或自定义） */
  systemPrompt?: string;
  /** 记忆上下文（desktop 侧渲染好的文本块：设备环境 + 用户习惯；缺省不注入） */
  memoryContext?: string;
  /** 记忆桥：updateMemory 工具把新备注落盘 ~/.zen/memory（desktop 注入；缺省不注册该工具） */
  memoryBridge?: MemoryAgentBridge;
  /** 技能清单提示（loadSkill 可取全文） */
  skills?: AgentSkillHint[];
  /** loadSkill 校验用：与设置页一致的技能搜索路径 */
  skillExtraPaths?: string[];
  /** 已启用 MCP server 的工具（动态桥接为 mcp.<server>.<tool>） */
  mcpTools?: McpToolBridge[];
  /** 内嵌 WebContentsView + CDP 浏览器桥（desktop 注入；缺省时不注册 browser.* 工具） */
  browserBridge?: BrowserAgentBridge;
  /** 是否启用多 Agent 协作工具（spawnAgent 等）；子 Agent 应为 false */
  multiAgent?: boolean;
  emit: (event: AgentStreamEvent) => void;
}

/** 组装系统提示词：预设/自定义 + 技能清单 + MCP 清单 + 多 Agent 约定 + 环境 */
export function buildInstructions(config: AgentSessionConfig): string | undefined {
  const parts: string[] = [];
  if (config.systemPrompt?.trim()) {
    parts.push(config.systemPrompt.trim());
  }
  if (config.skills?.length) {
    const lines = config.skills
      .map((skill) => `- ${skill.name}（id: ${skill.id}）：${skill.description || "无描述"}`)
      .join("\n");
    parts.push(
      `可用技能（按需用 loadSkill 工具加载全文后再遵循其流程）：\n${lines}\n不要对任务硬套技能；只有当技能确实匹配时才加载。`,
    );
  }
  if (config.mcpTools?.length) {
    const lines = config.mcpTools
      .map((bridge) => `- mcp.${bridge.serverName}.${bridge.name}: ${bridge.description ?? ""}`)
      .join("\n");
    parts.push(`已连接的 MCP 工具（调用前注意这些是外部服务）：\n${lines}`);
  }
  if (config.multiAgent !== false) {
    parts.push(multiAgentInstructions());
  }
  if (config.memoryContext?.trim()) {
    parts.push(config.memoryContext.trim());
  }
  if (config.memoryBridge) {
    parts.push(
      `长期记忆：当前会话已注入「设备环境记忆」与「用户习惯记忆」（若有）。` +
        `当用户明确要求记住某事，或出现值得长期保留的稳定事实（设备路径/命令、用户偏好与工作习惯）时，` +
        `用 updateMemory 工具追加一条简洁备注；只记录长期有效的信息，不记录一次性任务细节。`,
    );
  }
  parts.push(
    `当前工作目录：${config.workspaceRoot}\n系统平台：${process.platform}\n今天的日期：${new Date().toISOString().slice(0, 10)}`,
  );
  if (config.browserBridge) {
    parts.push(
      `内置浏览器已接入（WebContentsView + CDP）。流程：browserOpen 打开 [页面元素] 里的 page= URL → browserClick/browserType 使用同一元素的 selector。` +
        `本地 dev server 若打开失败：依次改试 http://127.0.0.1:<port> 与 http://[::1]:<port>（IPv6-only 监听时 localhost 可能连不上）。` +
        `不要因一次 open 失败就放弃浏览器工具改去盲猜组件；先确认 URL 再定位代码。`,
    );
  }
  return parts.join("\n\n");
}
