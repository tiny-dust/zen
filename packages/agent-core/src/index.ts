/**
 * agent-core 公共出口。
 *
 * 域文件：
 * - agent-session：会话运行时（AgentSession）
 * - agent-tools / agent-model / agent-approval / agent-config：工具集、模型、审批、配置
 * - agent-stream：流 part → 协议事件
 * - agent-parts：part 解析纯函数
 * - mock-agent：免配置 mock 运行
 * - mcp-runtime：MCP 运行时注册（main 侧注入）
 * - multi-agent / resource-lock / multi-agent-instructions：多 Agent 协作
 */
export { AgentSession } from "./agent-session";
export { runMockAgent } from "./mock-agent";
export { registerMcpRuntime } from "./mcp-runtime";
export type { AgentSkillHint, McpToolBridge, AgentSessionConfig } from "./agent-config";

export * from "./multi-agent";
export * from "./resource-lock";
export * from "./multi-agent-instructions";
