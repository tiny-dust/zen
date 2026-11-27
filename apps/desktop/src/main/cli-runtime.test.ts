import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { detectCliRuntimes, resolveOnPath, spawnCliProcess, startCliRun, stripAnsi } from "./cli-runtime";

const dir = mkdtempSync(join(tmpdir(), "zen-cli-runtime-"));
const okScript = join(dir, "claude");
const failScript = join(dir, "codex");

writeFileSync(
  okScript,
  [
    "#!/usr/bin/env node",
    "process.stdout.write('\\u001b[32mhello\\u001b[0m');",
    "setTimeout(() => { process.stdout.write(' world'); }, 20);",
  ].join("\n"),
);
writeFileSync(
  failScript,
  [
    "#!/usr/bin/env node",
    "process.stderr.write('not logged in');",
    "process.exit(1);",
  ].join("\n"),
);
chmodSync(okScript, 0o755);
chmodSync(failScript, 0o755);

afterAll(() => {
  // 临时目录随系统清理，这里不删除（Windows 下可能仍被占用）
});

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** 停止是异步生效的（SIGTERM 到进程真正退出有延迟），轮询到死为止 */
async function waitUntilDead(pid: number, timeoutMs = 3000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (!isAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe("cli-runtime 探测", () => {
  it("在 PATH 中找到可执行文件，找不到返回 null", () => {
    expect(resolveOnPath("claude", dir)).toBe(okScript);
    expect(resolveOnPath("nope-cli", dir)).toBeNull();
  });

  it("探测结果保持候选顺序，未安装的 path 为 null", () => {
    const result = detectCliRuntimes(dir);
    expect(result.map((item) => item.id)).toEqual(["claude", "codex"]);
    expect(result.every((item) => item.path === join(dir, item.command))).toBe(true);
    expect(detectCliRuntimes(join(dir, "missing")).every((item) => item.path === null)).toBe(true);
  });
});

describe("cli-runtime 运行", () => {
  it("流式输出去掉 ANSI 控制字符，正常退出 ok=true", async () => {
    const chunks: string[] = [];
    const run = startCliRun({
      id: "claude",
      path: okScript,
      prompt: "hi",
      cwd: dir,
      onDelta: (text) => chunks.push(text),
    });
    const result = await run.done;
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(chunks.join("")).toBe("hello world");
  });

  it("非零退出透出 stderr 便于判断未登录/参数错误", async () => {
    const run = startCliRun({
      id: "codex",
      path: failScript,
      prompt: "hi",
      cwd: dir,
      onDelta: () => undefined,
    });
    const result = await run.done;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("not logged in");
  });

  it.skipIf(process.platform === "win32")(
    "stop() 终止整个进程组：CLI 拉起的后代一起退出",
    async () => {
      // 长跑 CLI：先起一个孙进程并打印其 pid，然后自己挂住不退
      const longScript = join(dir, "claude-long");
      writeFileSync(
        longScript,
        [
          "#!/usr/bin/env node",
          "const { spawn } = require('node:child_process');",
          "const g = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
          "process.stdout.write(String(g.pid) + '\\n');",
          "setInterval(() => {}, 1000);",
        ].join("\n"),
      );
      chmodSync(longScript, 0o755);

      let resolvePid: (pid: number) => void = () => undefined;
      const pidReady = new Promise<number>((resolve) => {
        resolvePid = resolve;
      });
      const run = startCliRun({
        id: "claude",
        path: longScript,
        prompt: "hi",
        cwd: dir,
        onDelta: (text) => {
          const pid = Number(text.trim());
          if (Number.isInteger(pid) && pid > 0) {
            resolvePid(pid);
          }
        },
      });

      const grandchildPid = await pidReady;
      expect(isAlive(grandchildPid)).toBe(true);

      run.stop();
      const result = await run.done;
      expect(result.ok).toBe(false);

      await waitUntilDead(grandchildPid);
      expect(isAlive(grandchildPid)).toBe(false);
    },
  );
});

describe("stripAnsi", () => {
  it("去掉着色与回车覆盖", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m\r\n")).toBe("red\n");
  });
});

describe("spawnCliProcess（按配方传参）", () => {
  it("参数数组原样交给子进程，含空格与 shell 元字符也不拆开", async () => {
    // 回显 argv 的假 CLI：能看出是否被 shell 二次拆分
    const echoScript = join(dir, "echo-args");
    writeFileSync(
      echoScript,
      ["#!/usr/bin/env node", "process.stdout.write(JSON.stringify(process.argv.slice(2)));"].join("\n"),
    );
    chmodSync(echoScript, 0o755);

    const chunks: string[] = [];
    const run = spawnCliProcess({
      path: echoScript,
      args: ["--resume", "s-1", "-p", "hi there; rm -rf /"],
      cwd: dir,
      onDelta: (text) => chunks.push(text),
    });
    const result = await run.done;
    expect(result.ok).toBe(true);
    expect(JSON.parse(chunks.join(""))).toEqual(["--resume", "s-1", "-p", "hi there; rm -rf /"]);
  });

  it("可执行文件不存在时 resolve 失败而不是抛出", async () => {
    const run = spawnCliProcess({
      path: join(dir, "no-such-cli"),
      args: [],
      cwd: dir,
      onDelta: () => undefined,
    });
    const result = await run.done;
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
