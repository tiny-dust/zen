import { lstatSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { isMcpToolName } from "@zen/shared";
import { resolveWorkspacePath } from "@zen/tools-fs";

import type { PermissionMode, ToolRisk } from "@zen/shared";

export type ApprovalVerdict = "allow" | "confirm";

/** 仅识别有限的简单命令，不尝试解释完整 shell 语法；未知选项要求确认。 */
const READONLY_OPTIONS: Record<string, RegExp> = {
  ls: /^(?:-[a-zA-Z1]+|--(?:all|almost-all|long|human-readable|recursive|color(?:=\w+)?))$/,
  cat: /^(?:-[benstuvETAs]+|--(?:number|number-nonblank|show-all))$/,
  head: /^(?:-\d+|-[nqc]|--(?:lines|bytes)(?:=\d+)?)$/,
  tail: /^(?:-\d+|-[nqc]|--(?:lines|bytes)(?:=\d+)?)$/,
  wc: /^(?:-[clmwL]+|--(?:bytes|chars|lines|words|max-line-length))$/,
  pwd: /^-[LP]$/,
  echo: /^-[enE]+$/,
  which: /^(?:-[as]+|--all)$/,
  whoami: /^(?:--help|--version)$/,
  date: /^(?:-[uR]|--(?:utc|universal|iso-8601(?:=\w+)?))$/,
  file: /^(?:-[bihLNz]+|--(?:brief|mime|mime-type|mime-encoding|dereference|version))$/,
  grep: /^(?:-[A-Za-z]+|--(?:color(?:=\w+)?|include=.+|exclude=.+|exclude-dir=.+))$/,
  rg: /^(?:-[nirlwvoUcFSs]+|--(?:files|hidden|no-ignore|line-number|ignore-case|files-with-matches|count|fixed-strings|word-regexp|glob=.+|type=.+|color=\w+))$/,
  find: /^-(?:H|L|P|name|iname|path|ipath|type|maxdepth|mindepth|size|mtime|mmin|atime|amin|ctime|cmin|newer|empty|print|print0|ls|prune|depth|xdev|mount|a|o|and|or|not)$/,
};

const GIT_READONLY_OPTIONS = /^(?:--(?:short|branch|porcelain(?:=v?[12])?|untracked-files(?:=\w+)?|oneline|stat|name-only|name-status|no-color|color=never|cached|staged|no-ext-diff|no-textconv|abbrev-ref|show-toplevel|show-prefix|git-dir|is-inside-work-tree|verify|quiet)|-[n\d]+)$/;

/** 所有支持的连接符两侧都必须是非空的简单只读命令。 */
const SHELL_SEPARATOR_RE = /\|\||&&|[;|]/;

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

function isReadonlySegment(segment: string): boolean {
  // 只支持独立的普通参数或完整引号参数；拼接引号、未闭合引号不作 shell 推断。
  const tokenPattern = /"[^"\r\n]*"|'[^'\r\n]*'|[^\s'"]+/g;
  const tokens: string[] = [];
  let end = 0;
  for (const match of segment.matchAll(tokenPattern)) {
    if ((tokens.length > 0 && match.index === end) || segment.slice(end, match.index).trim()) {
      return false;
    }
    tokens.push(match[0]);
    end = match.index + match[0].length;
  }
  if (segment.slice(end).trim() || tokens.length === 0) {
    return false;
  }
  // 未引用通配符可能展开出 -delete、--pre 等选项，不能只检查展开前的文本。
  if (tokens.some((token) => !/^["']/.test(token) && /[*?]/.test(token))) {
    return false;
  }
  const [name, ...args] = tokens.map((token) => token.replace(/^(['"])(.*)\1$/, "$2"));
  // 命令名本身不接受引号、路径、别名展开或动态构造。
  if (!name || name !== tokens[0]) {
    return false;
  }
  if (name === "node" || name === "python" || name === "python3") {
    const versionFlag = name === "node" ? "-v" : "-V";
    return args.length === 1 && (args[0] === versionFlag || args[0] === "--version");
  }
  if (name === "npm" || name === "pnpm") {
    const [subcommand, ...params] = args;
    if (!subcommand) {
      return false;
    }
    // 保留既有测试允许的 npm test 形式，不扩展到任意脚本/参数。
    if (name === "npm" && subcommand === "test") {
      return params.join(" ") === "--" || params.join(" ") === "-- --watch";
    }
    if (name === "pnpm" && subcommand === "-v") {
      return params.length === 0;
    }
    const allowed = name === "npm" ? ["ls", "view", "search"] : ["ls", "list"];
    return allowed.includes(subcommand) && params.every((arg) => !arg.startsWith("-"));
  }
  if (name === "git") {
    const [subcommand, ...params] = args;
    if (!subcommand) {
      return false;
    }
    if (subcommand === "remote") {
      return params.length === 0 || (params.length === 1 && params[0] === "-v");
    }
    if (subcommand === "branch" || subcommand === "tag") {
      const listOptions = subcommand === "branch" ? /^(?:-[arv]+|--show-current|--no-color)$/ : /^--no-color$/;
      const listIndex = params.indexOf("--list");
      return params.every((arg, index) =>
        listOptions.test(arg) || arg === "--list" || (listIndex >= 0 && index > listIndex && !arg.startsWith("-")),
      );
    }
    return ["status", "log", "diff", "show", "rev-parse"].includes(subcommand)
      && params.every((arg) => arg === "--" || !arg.startsWith("-") || GIT_READONLY_OPTIONS.test(arg));
  }
  const options = Object.hasOwn(READONLY_OPTIONS, name) ? READONLY_OPTIONS[name] : undefined;
  if (!options) {
    return false;
  }
  // date 的纯数字位置参数可设置系统时间；只接受格式串与明确只读选项。
  if (name === "date") {
    return args.every((arg) => arg.startsWith("+") || options.test(arg));
  }
  return args.every((arg) => arg === "--" || !arg.startsWith("-") || options.test(arg));
}

function isReadonlyCommand(command: string): boolean {
  // 同时覆盖 POSIX、cmd 和 PowerShell 的替换/转义/重定向；即使在引号内也保守确认。
  if (/[<>$`\\\r\n\x00-\x1f\x7f(){}\[\]%!^#@\u2018\u2019\u201c\u201d]/.test(command) || /(?<!&)&(?!&)/.test(command)) {
    return false;
  }
  return command.split(SHELL_SEPARATOR_RE).every(isReadonlySegment);
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
