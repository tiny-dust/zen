import { describe, expect, it } from "vitest";

import { evaluateApproval, riskForTool } from "./agent-approval";

/**
 * ADR-004 权限矩阵：
 * - riskForTool 覆盖 read/write/exec/network 与 mcp.* 前缀、未知工具兜底
 * - evaluateApproval：full 直接放行；read 放行；remembered 放行；
 *   smart 下写放行、只读命令放行、其余确认；default 除 read 外全确认
 */

describe("riskForTool", () => {
  it("只读工具归 read", () => {
    for (const name of [
      "readFile",
      "listDir",
      "searchFiles",
      "updateTasks",
      "webSearch",
      "loadSkill",
      "askUser",
      "spawnAgent",
      "listAgents",
      "waitForAgents",
      "collectAgentResults",
      "browserSnapshot",
      "browserExtract",
      "browserConsole",
      "browserPerformance",
      "browserScreenshot",
      "browserStatus",
    ]) {
      expect(riskForTool(name)).toBe("read");
    }
  });

  it("写 / 终端 / 网络类归对应风险", () => {
    expect(riskForTool("writeFile")).toBe("write");
    expect(riskForTool("editFile")).toBe("write");
    expect(riskForTool("runTerminal")).toBe("exec");
    for (const name of [
      "browserOpen",
      "browserClick",
      "browserType",
      "browserEvaluate",
      "mcp.lark.doc",
    ]) {
      expect(riskForTool(name)).toBe("network");
    }
  });

  it("未知工具按 exec 兜底", () => {
    expect(riskForTool("someUnknownTool")).toBe("exec");
  });
});

describe("evaluateApproval", () => {
  it("full 模式全部放行", () => {
    expect(evaluateApproval("runTerminal", "full", { remembered: false })).toBe("allow");
    expect(evaluateApproval("unknown", "full", { remembered: false })).toBe("allow");
  });

  it("read 风险任意模式放行", () => {
    expect(evaluateApproval("readFile", "default", { remembered: false })).toBe("allow");
    expect(evaluateApproval("readFile", "smart", { remembered: false })).toBe("allow");
  });

  it("会话内已放行过的工具不再确认", () => {
    expect(evaluateApproval("runTerminal", "smart", { remembered: true })).toBe("allow");
    expect(evaluateApproval("runTerminal", "default", { remembered: true })).toBe("allow");
  });

  it("smart 模式写工具放行，网络类确认", () => {
    expect(evaluateApproval("writeFile", "smart", { remembered: false })).toBe("allow");
    expect(evaluateApproval("editFile", "smart", { remembered: false })).toBe("allow");
    expect(evaluateApproval("browserOpen", "smart", { remembered: false })).toBe("confirm");
    expect(evaluateApproval("mcp.lark.send", "smart", { remembered: false })).toBe("confirm");
  });

  it("smart 模式只读终端命令放行，危险命令确认", () => {
    // 单段白名单回归
    for (const command of [
      "ls -la",
      "cat README.md",
      "git status",
      "git log --oneline",
      "npm view lodash",
      "npm ls",
      "node -v",
      "python3 --version",
      "grep -rn foo src",
      "npm test --",
      "npm test -- --watch",
    ]) {
      expect(evaluateApproval("runTerminal", "smart", { remembered: false, command })).toBe("allow");
    }
    for (const command of ["rm -rf /", "git push origin main", "npm publish"]) {
      expect(evaluateApproval("runTerminal", "smart", { remembered: false, command })).toBe("confirm");
    }
    // 多段命令按连接符拆分后逐段校验，全只读管道/串联放行
    for (const command of ["ls && git status", "cat a.txt | head"]) {
      expect(evaluateApproval("runTerminal", "smart", { remembered: false, command })).toBe("allow");
    }
    // 任一段不只读则整条命令需确认
    for (const command of ["echo hi && rm x", "echo hi && rm -rf /"]) {
      expect(evaluateApproval("runTerminal", "smart", { remembered: false, command })).toBe("confirm");
    }
    // 无 command 信息时保守确认
    expect(evaluateApproval("runTerminal", "smart", { remembered: false })).toBe("confirm");
  });

  it("default 模式除 read 外全部确认", () => {
    expect(evaluateApproval("writeFile", "default", { remembered: false })).toBe("confirm");
    expect(evaluateApproval("runTerminal", "default", { remembered: false, command: "ls" })).toBe(
      "confirm",
    );
  });
});
