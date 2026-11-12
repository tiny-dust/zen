import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { isMcpToolName } from "@zen/shared";
import { resolveWorkspacePath } from "@zen/tools-fs";

import type { PermissionMode, ToolRisk } from "@zen/shared";

export type ApprovalVerdict = "allow" | "confirm";

/** 只读终端命令白名单：smart 模式自动放行 */
const READONLY_COMMAND_RE =
  /^\s*(ls|cat|head|tail|wc|pwd|echo|which|whoami|date|file|find|grep|rg|node\s+(-v|--version)|npm\s+(ls|view|search|test --)|git\s+(status|log|diff|show|branch|rev-parse|remote|tag)|pnpm\s+(ls|list|-v)|python3?\s+(-V|--version))(?=\s|$|;|\||&)/;

/** shell 连接符：命令需按连接符拆分后逐段校验，任一段不只读则整条命令需确认 */
const SHELL_SEPARATOR_RE = /\|\||&&|[;|&\r\n]/;

export function riskForTool(toolName: string): ToolRisk {
  if (
    toolName === "readFile" ||
    toolName === "listDir" ||
    toolName === "searchFiles" ||
    toolName === "updateTasks" ||
    toolName === "webSearch" ||
    toolName === "webFetch" ||
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
    toolName === "browserStatus" ||
    toolName === "cuaStatus" ||
    toolName === "cuaScreenSize"
  ) {
    return "read";
  }
  if (isMcpToolName(toolName)) {
    return "network";
  }
  return "exec";
}

function isReadonlyCommand(command: string): boolean {
  // 引号内的连接符会被拆开：拆出的片段无法命中白名单时倾向 confirm，方向保守
  const segments = command.split(SHELL_SEPARATOR_RE).filter((segment) => segment.trim().length > 0);
  return segments.length > 0 && segments.every((segment) => READONLY_COMMAND_RE.test(segment));
}

/** 路径解析与 tools-fs 一致；不存在的新文件按最近的真实父目录判断，无法判定则要求审批。 */
export function requiresManualFileWriteApproval(
  toolName: string,
  workspaceRoot?: string,
  path?: string,
): boolean {
  if (toolName !== "writeFile" && toolName !== "editFile") {
    return false;
  }
  if (!workspaceRoot || typeof path !== "string" || !path.trim()) {
    return true;
  }
  try {
    const root = realpathSync(workspaceRoot);
    const target = resolveWorkspacePath(workspaceRoot, path);
    let ancestor = target;
    for (;;) {
      try {
        lstatSync(ancestor);
        break;
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" &&
          (error as NodeJS.ErrnoException).code !== "ENOTDIR"
        ) {
          throw error;
        }
        const parent = dirname(ancestor);
        if (parent === ancestor) {
          return true;
        }
        ancestor = parent;
      }
    }
    // realpathSync 会跟随已存在的符号链接；悬空链接解析失败时保守确认。
    const canonicalTarget = resolve(realpathSync(ancestor), relative(ancestor, target));
    const withinRoot = relative(root, canonicalTarget);
    return withinRoot === ".." || withinRoot.startsWith(`..${sep}`) || isAbsolute(withinRoot);
  } catch {
    return true;
  }
}

/**
 * 单工具审批裁决（ADR-004 权限矩阵）。
 * 会话级「全部允许」与网络类确认记忆由 AgentSession 维护，命中后直接放行。
 */
export function evaluateApproval(
  toolName: string,
  mode: PermissionMode,
  options: { remembered: boolean; command?: string; workspaceRoot?: string; path?: string },
): ApprovalVerdict {
  if (mode === "full") {
    return "allow";
  }
  const risk = riskForTool(toolName);
  if (risk === "read") {
    return "allow";
  }
  if (mode === "smart" && requiresManualFileWriteApproval(toolName, options.workspaceRoot, options.path)) {
    return "confirm";
  }
  // 本会话内用户已放行过的工具（「全部允许」/ 网络类确认过）不再逐次确认
  if (options.remembered) {
    return "allow";
  }
  if (mode === "smart") {
    if (risk === "write") {
      // 工作区内写操作仍按原 smart 权限放行
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
