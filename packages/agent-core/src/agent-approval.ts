import type { PermissionMode, ToolRisk } from "@zen/shared";

export type ApprovalVerdict = "allow" | "confirm";

/** 只读终端命令白名单：smart 模式自动放行 */
const READONLY_COMMAND_RE =
  /^\s*(ls|cat|head|tail|wc|pwd|echo|which|whoami|date|file|find|grep|rg|node\s+(-v|--version)|npm\s+(ls|view|search|test --)|git\s+(status|log|diff|show|branch|rev-parse|remote|tag)|pnpm\s+(ls|list|-v)|python3?\s+(-V|--version))\b/;

export function riskForTool(toolName: string): ToolRisk {
  if (
    toolName === "readFile" ||
    toolName === "listDir" ||
    toolName === "searchFiles" ||
    toolName === "updateTasks" ||
    toolName === "webSearch" ||
    toolName === "loadSkill" ||
    toolName === "askUser" ||
    toolName === "spawnAgent" ||
    toolName === "listAgents" ||
    toolName === "waitForAgents" ||
    toolName === "collectAgentResults"
  ) {
    return "read";
  }
  if (toolName === "writeFile" || toolName === "editFile") {
    return "write";
  }
  if (toolName === "runTerminal") {
    return "exec";
  }
  if (
    toolName === "browserOpen" ||
    toolName === "browserClick" ||
    toolName === "browserType" ||
    toolName === "browserEvaluate"
  ) {
    return "network";
  }
  if (
    toolName === "browserSnapshot" ||
    toolName === "browserExtract" ||
    toolName === "browserConsole" ||
    toolName === "browserPerformance" ||
    toolName === "browserScreenshot" ||
    toolName === "browserStatus"
  ) {
    return "read";
  }
  if (toolName.startsWith("mcp.")) {
    return "network";
  }
  return "exec";
}

function isReadonlyCommand(command: string): boolean {
  return READONLY_COMMAND_RE.test(command);
}

/**
 * 单工具审批裁决（ADR-004 权限矩阵）。
 * 会话级「全部允许」与网络类确认记忆由 AgentSession 维护，命中后直接放行。
 */
export function evaluateApproval(
  toolName: string,
  mode: PermissionMode,
  options: { remembered: boolean; command?: string },
): ApprovalVerdict {
  if (mode === "full") {
    return "allow";
  }
  const risk = riskForTool(toolName);
  if (risk === "read") {
    return "allow";
  }
  // 本会话内用户已放行过的工具（「全部允许」/ 网络类确认过）不再逐次确认
  if (options.remembered) {
    return "allow";
  }
  if (mode === "smart") {
    if (risk === "write") {
      // writeFile/editFile 的 path 都被 tools-fs 约束在工作区内
      return "allow";
    }
    if (risk === "exec" && options.command && isReadonlyCommand(options.command)) {
      return "allow";
    }
    return "confirm";
  }
  // default：除 read 外全部确认
  return "confirm";
}
