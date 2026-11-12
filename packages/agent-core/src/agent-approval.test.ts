import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { evaluateApproval, requiresManualFileWriteApproval, riskForTool } from "./agent-approval";

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function workspaceFixture() {
  const base = await mkdtemp(join(tmpdir(), "zen-approval-"));
  fixtures.push(base);
  const root = join(base, "workspace");
  const outside = join(base, "workspace-neighbor");
  await mkdir(root);
  await mkdir(outside);
  return { base, root, outside };
}

/**
 * ADR-004 权限矩阵：
 * - riskForTool 覆盖 read/write/exec/network 与 mcp.* 前缀、未知工具兜底
 * - evaluateApproval：full 直接放行；read 放行；smart 工作区外写必须审批，
 *   工作区内写和只读命令放行；default 除 read 外全确认
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
      "mcp__lark__doc",
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

  it("smart 模式工作区内写工具放行，网络类确认", async () => {
    const { root } = await workspaceFixture();
    expect(evaluateApproval("writeFile", "smart", { remembered: false, workspaceRoot: root, path: "new.txt" })).toBe("allow");
    expect(evaluateApproval("editFile", "smart", { remembered: false, workspaceRoot: root, path: "new.txt" })).toBe("allow");
    expect(evaluateApproval("browserOpen", "smart", { remembered: false })).toBe("confirm");
    expect(evaluateApproval("mcp__lark__send", "smart", { remembered: false })).toBe("confirm");
  });

  it("绝对路径、相对 ..、~ 与目录边界均按实际目标审批", async () => {
    const { base, root, outside } = await workspaceFixture();
    const cases: Array<[string, "allow" | "confirm"]> = [
      ["file.txt", "allow"],
      ["nested/new/file.txt", "allow"],
      [join(root, "new.txt"), "allow"],
      ["nested/../file.txt", "allow"],
      [join(outside, "existing.txt"), "confirm"],
      [join(outside, "missing/deep/file.txt"), "confirm"],
      ["../workspace-neighbor/existing.txt", "confirm"],
      ["nested/../../workspace-neighbor/file.txt", "confirm"],
      [join(base, "workspace-neighborly/file.txt"), "confirm"],
      ["~/zen-approval-outside.txt", "confirm"],
      ["~", "confirm"],
      [' "../workspace-neighbor/existing.txt" ', "confirm"],
      ["..\\workspace-neighbor\\existing.txt", "confirm"],
    ];
    for (const toolName of ["writeFile", "editFile"]) {
      for (const [path, expected] of cases) {
        expect(evaluateApproval(toolName, "smart", { remembered: false, workspaceRoot: root, path }), `${toolName} ${path}`).toBe(expected);
      }
      expect(evaluateApproval(toolName, "smart", { remembered: true, workspaceRoot: root, path: join(outside, "existing.txt") })).toBe("confirm");
      expect(evaluateApproval(toolName, "full", { remembered: false, workspaceRoot: root, path: join(outside, "existing.txt") })).toBe("allow");
      expect(evaluateApproval(toolName, "default", { remembered: false, workspaceRoot: root, path: "file.txt" })).toBe("confirm");
    }
    expect(evaluateApproval("writeFile", "smart", { remembered: false, workspaceRoot: root, path: join(homedir(), "zen-approval-outside.txt") })).toBe("confirm");
  });

  it("现有文件、父目录与工作区根符号链接按真实位置判定", async () => {
    const { base, root, outside } = await workspaceFixture();
    await writeFile(join(outside, "existing.txt"), "outside");
    await writeFile(join(root, "internal.txt"), "inside");
    await symlink(join(outside, "existing.txt"), join(root, "external-file.txt"));
    await symlink(outside, join(root, "external-dir"), "dir");
    await symlink(join(root, "internal.txt"), join(root, "internal-link.txt"));
    await mkdir(join(root, "internal-dir"));
    await symlink(join(root, "internal-dir"), join(root, "internal-dir-link"), "dir");
    await symlink(join(root, "missing-inside.txt"), join(root, "dangling-link.txt"));
    await symlink(root, join(base, "workspace-link"), "dir");
    for (const toolName of ["writeFile", "editFile"]) {
      for (const path of ["external-file.txt", "external-dir/existing.txt", "external-dir/new/deep.txt", "dangling-link.txt"]) {
        expect(evaluateApproval(toolName, "smart", { remembered: false, workspaceRoot: root, path }), path).toBe("confirm");
      }
      expect(evaluateApproval(toolName, "smart", { remembered: false, workspaceRoot: root, path: "internal-link.txt" })).toBe("allow");
      expect(evaluateApproval(toolName, "smart", { remembered: false, workspaceRoot: root, path: "internal-dir-link/new.txt" })).toBe("allow");
      expect(evaluateApproval(toolName, "smart", { remembered: false, workspaceRoot: join(base, "workspace-link"), path: "internal.txt" })).toBe("allow");
      expect(evaluateApproval(toolName, "smart", { remembered: false, workspaceRoot: root, path: join(base, "workspace-link", "internal.txt") })).toBe("allow");
    }
  });

  it("空路径、缺失上下文或无法解析路径保守审批；非文件工具不受影响", async () => {
    const { root } = await workspaceFixture();
    for (const path of ["", "   ", "C:/Windows/file.txt"]) {
      expect(evaluateApproval("writeFile", "smart", { remembered: false, workspaceRoot: root, path })).toBe("confirm");
    }
    expect(evaluateApproval("editFile", "smart", { remembered: false, workspaceRoot: root })).toBe("confirm");
    expect(evaluateApproval("writeFile", "smart", { remembered: false, path: "file.txt" })).toBe("confirm");
    expect(requiresManualFileWriteApproval("runTerminal", root, "../outside.txt")).toBe(false);
    expect(evaluateApproval("runTerminal", "smart", { remembered: false, command: "ls" })).toBe("allow");
    expect(evaluateApproval("readFile", "smart", { remembered: false, path: "../outside.txt" })).toBe("allow");
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
