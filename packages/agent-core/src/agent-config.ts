import { multiAgentInstructions } from "./multi-agent-instructions";
import type { ResourceLock } from "./resource-lock";

import { mcpToolWireName } from "@zen/shared";
import type { ModelMessage } from "ai";
import type {
  AgentStreamEvent,
  BrowserAgentBridge,
  CuaAgentBridge,
  PermissionMode,
  ProviderProtocol,
  ReasoningEffort,
  WebSearchApiProviderId,
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

/** 长驻服务桥（main 侧登记 runTerminal 进程组；settle 后收集存活服务） */
export interface ServicesAgentBridge {
  /** runTerminal 已 spawn（detached，pid 即进程组 id）：登记命令与归属会话 */
  track(request: { sessionId: string; command: string; cwd: string; pid: number }): void;
  /** runTerminal 结束（完成/超时/中断）：检测进程组存活者，有则收集为长驻服务 */
  settle(pid: number): void;
}

export interface AgentSessionConfig {
  sessionId: string;
  workspaceRoot: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  /** 模型是否具备推理能力（用于 Anthropic adaptive 思考与推理档位映射） */
  reasoning?: boolean;
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
  /** 已启用 MCP server 的工具（动态桥接为 mcp__<server>__<tool>） */
  mcpTools?: McpToolBridge[];
  /** 内嵌 WebContentsView + CDP 浏览器桥（desktop 注入；缺省时不注册 browser.* 工具） */
  browserBridge?: BrowserAgentBridge;
  /** CUA 桌面自动化桥（desktop 注入，受 agent settings cuaEnabled 总开关控制；缺省不注册 cua.* 工具） */
  cuaBridge?: CuaAgentBridge;
  /** 长驻服务桥（desktop 注入；runTerminal 进程组登记与收集，缺省不收集） */
  servicesBridge?: ServicesAgentBridge;
  /** 文件快照桥（main 注入）：writeFile/editFile 实际写入前备份原文件；失败不阻塞写入 */
  checkpointBridge?: { backupFile(relativePath: string): Promise<void> };
  /** 网络搜索 API Key（desktop 注入）：配置了的供应商优先于免登录抓取（DDG/Bing） */
  webSearchApiKeys?: Partial<Record<WebSearchApiProviderId, string>>;
  /**
   * 模型上下文窗口（tokens）。> 0 时 agent-core 在 run 内步间按真实 usage 主动压缩；
   * 未提供（未知窗口）则不主动压缩，只保留溢出报错后的恢复与手动压缩。
   */
  contextWindow?: number;
  /**
   * 历史摘要函数（步间主动压缩用）：缺省用当前会话模型跑结构化摘要（summarizeWithModel），
   * 返回 null/抛错时回退确定性裁剪。注入以便测试替换。
   */
  summarizeHistory?: (
    messages: ModelMessage[],
    previousInstructions?: string | null,
  ) => Promise<string | null>;
  /** 是否启用多 Agent 协作工具（spawnAgent 等）；子 Agent 应为 false */
  multiAgent?: boolean;
  /**
   * 共享资源锁（写/终端/浏览器互斥）。子 Agent 必须传入父会话同一实例，
   * 否则互斥失效（各自 new ResourceLock）。
   */
  resourceLock?: ResourceLock;
  /** 资源锁 owner 标签；多 Agent 时应对齐 AgentNodeState.id 以驱动 busyResource */
  ownerLabel?: string;
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
      .map((bridge) => `- ${mcpToolWireName(bridge.serverName, bridge.name)}: ${bridge.description ?? ""}`)
      .join("\n");
    parts.push(
      `已连接的 MCP 工具（按任务主动调用，不要被动等用户点名）：\n${lines}\n` +
        `主动调用规则：\n` +
        `1. 当用户任务与某个 MCP 工具的用途/描述匹配时（尤其是飞书/Lark、日历、文档、邮件、任务等外部域操作），` +
        `优先调用对应的 mcp__<server>__<tool> 完成，而不是用内置工具模拟、编造结果，或反问用户「要不要用某某」。\n` +
        `2. 工具参数不明确时，先读该工具的描述与输入 schema 再调用；同一 server 有多个工具时选用途最贴合的那个。\n` +
        `3. 调用失败时把错误原文透出，并给出替代方案（换其它工具/让用户检查服务配置），不要静默吞掉。\n` +
        `4. 清单里没有能覆盖任务的 MCP 工具、而任务又明确需要外部系统时，提示用户到「MCP 服务」弹窗配置或启用对应服务。\n` +
        `5. 用户消息里出现 #mcp:<server>.<tool> 形式的引用（输入框 # 菜单插入的 token）时，表示用户明确指名该工具` +
        `（引用中的 server/tool 与工具名 mcp__<server>__<tool> 对应），优先按引用调用它完成对应步骤。`,
    );
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
  if (config.cuaBridge) {
    parts.push(
      `CUA 桌面自动化已启用：cuaStatus/cuaScreenSize/cuaMouseMove/cuaMouseClick/cuaKeyboardType/cuaKey 可直接控制桌面（鼠标/键盘）。` +
        `操作目标坐标先用 cuaScreenSize 了解屏幕范围；组合键写法 "ctrl+c"/"cmd+shift+3"。` +
        `桌面操作影响系统全局状态，非明确要求不要连续盲点；失败时读 error 原因再重试。`,
    );
  }
  return parts.join("\n\n");
}
