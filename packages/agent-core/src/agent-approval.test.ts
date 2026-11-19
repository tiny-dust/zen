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

  // 所有下列字符串只交给 evaluateApproval，绝不交给 shell 执行。
  it.each([
    "pwd", "whoami", "date", "date -u", "which node", "file README.md",
    "ls -la", "cat 'file with spaces.txt'", 'head -n 10 "file with spaces.txt"',
    "tail -n 5 README.md", "wc -l README.md", 'grep -rn "hello world" src',
    "rg --files src", "rg -n foo src", "echo hello", "echo 'hello world'",
    "find . -name '*.ts' -type f -print", "find src -maxdepth 2 -type d",
    "git status --short", "git log --oneline -n 5", "git diff --stat",
    "git show HEAD", "git rev-parse --show-toplevel", "git branch", "git branch -av",
    "git branch --show-current", "git branch --list 'feature/*'",
    "git remote", "git remote -v", "git tag", "git tag --list 'v*'",
    "npm ls", "npm view lodash", "npm search lodash", "pnpm list", "pnpm -v",
    "node --version", "python -V", "python3 --version",
    "ls && git status", "cat a.txt | head", "git status || git log --oneline",
    "pwd; whoami", 'cat "a b.txt" | grep foo && wc -l README.md',
  ])("smart 简单只读命令保留放行：%s", (command) => {
    expect(evaluateApproval("runTerminal", "smart", { remembered: false, command })).toBe("allow");
  });

  it.each([
    "echo probe > approval-probe.txt", "echo probe>>approval-probe.txt",
    "git status 2>errors.txt", "cat a.txt 1<>out.txt", "echo hi &>out.txt",
    "cat < input.txt", "cat <<EOF", "echo hi | tee out.txt",
    "echo $(rm marker)", 'echo "$(rm marker)"', "echo `rm marker`",
    "cat <(rm marker)", "echo ${value}", "echo $((1+2))",
    "echo %COMSPEC%", "echo !value!", "echo ^& rm marker", "echo hi & rm marker",
    "echo hi &", "echo hi\nrm marker", "echo hi\r\nrm marker",
    "echo hi\u0000rm marker", "echo hi\u001brm marker", "echo hi # comment",
    "echo foo\\\nrm marker", "echo foo\\bar", 'cat "C:\\Users\\file.txt"',
    "find . -delete", "find . -exec rm marker +", "find . -execdir rm marker +",
    "find . -ok rm marker +", "find . -okdir rm marker +",
    "find . -fprint approval-probe.txt", "find . -fprint0 out.txt",
    "find . -fprintf out.txt format", "find . -fls out.txt", "find . --unknown-option",
    "git branch approval-probe", "git branch -D main", "git branch -m renamed",
    "git branch --copy main copied", "git branch --set-upstream-to=origin/main",
    "git branch --list -D main", "git remote add probe example.invalid",
    "git remote set-url origin example.invalid", "git remote remove origin",
    "git remote rename origin renamed", "git remote update", "git remote prune origin",
    "git tag approval-probe", "git tag -d v1", "git tag -a v1 -m message",
    "git tag --list --delete v1", "git log --output=out.txt",
    "git diff --output out.txt", "git diff --ext-diff", "git show --textconv HEAD",
    "git -c alias.status=anything status", "git status --unknown-option",
    "node -v script.js", "node --version --eval anything", "python3 -v",
    "python3 --version script.py", "npm test -- --eval anything",
    "npm view lodash --cache=cache-dir", "pnpm list --unknown-option",
    "rg --pre=anything foo", "rg --pre anything foo", "rg --hostname-bin anything foo",
    "file -C", "file --compile", "date -s tomorrow", "date 111912002026",
    "date --set=tomorrow", "ls --unknown-option", "constructor", "toString",
    "", "   ", "| ls", "ls |", "ls &&", "ls ;; pwd", "ls &&& pwd",
    "ls ||| pwd", 'echo "unterminated', "echo 'unterminated", 'l""s',
    '"ls"', "echo foo'bar'", "echo 'a; ls'", 'echo "a|cat"',
    "echo {one,two}", "echo [one]", "(ls)", "if true; then ls; fi",
    "find *", "rg * foo", "ls *.ts", "find . -name *.ts",
    "rg @arguments", "find @arguments", "rg “--pre=anything” foo", "rg ‘--pre=anything’ foo",
    "git", "npm", "pnpm", "git branch --edit-description", "git branch --unset-upstream",
  ])("smart 副作用或未知复杂语法要求确认：%s", (command) => {
    expect(evaluateApproval("runTerminal", "smart", { remembered: false, command })).toBe("confirm");
  });

  it.each(["echo hi > out.txt", "find . -delete", "git branch created", "echo $(anything)"])(
    "终端规则不改变 full/default/remembered 语义：%s", (command) => {
      expect(evaluateApproval("runTerminal", "full", { remembered: false, command })).toBe("allow");
      expect(evaluateApproval("runTerminal", "default", { remembered: false, command })).toBe("confirm");
      for (const mode of ["smart", "default"] as const) {
        expect(evaluateApproval("runTerminal", mode, { remembered: true, command })).toBe("allow");
      }
    },
  );

  it("default 模式除 read 外全部确认", () => {
    expect(evaluateApproval("writeFile", "default", { remembered: false })).toBe("confirm");
    expect(evaluateApproval("runTerminal", "default", { remembered: false, command: "ls" })).toBe(
      "confirm",
    );
  });
});
