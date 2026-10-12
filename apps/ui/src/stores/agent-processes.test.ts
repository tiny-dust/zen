import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { isPersistentCommand, useAgentProcessesStore } from "./agent-processes";

describe("isPersistentCommand", () => {
  it("匹配常见常驻服务命令", () => {
    expect(isPersistentCommand("npm run dev")).toBe(true);
    expect(isPersistentCommand("pnpm run serve")).toBe(true);
    expect(isPersistentCommand("yarn start")).toBe(true);
    expect(isPersistentCommand("vite")).toBe(true);
    expect(isPersistentCommand("npx next dev")).toBe(true);
    expect(isPersistentCommand("nodemon server.js")).toBe(true);
    expect(isPersistentCommand("docker compose up")).toBe(true);
    expect(isPersistentCommand("tail -f /var/log/app.log")).toBe(true);
    expect(isPersistentCommand("python -m http.server 8000")).toBe(true);
    expect(isPersistentCommand("cargo watch -x run")).toBe(true);
    expect(isPersistentCommand("webpack --watch")).toBe(true);
  });

  it("过滤一次性命令", () => {
    expect(isPersistentCommand("")).toBe(false);
    expect(isPersistentCommand("ls -la")).toBe(false);
    expect(isPersistentCommand("cat package.json")).toBe(false);
    expect(isPersistentCommand("git status")).toBe(false);
    expect(isPersistentCommand("npm install")).toBe(false);
    expect(isPersistentCommand("npm test")).toBe(false);
    expect(isPersistentCommand("echo hello")).toBe(false);
    expect(isPersistentCommand("mkdir -p src")).toBe(false);
  });
});

describe("useAgentProcessesStore 移除记录", () => {
  const SESSION = "session-1";

  beforeEach(() => {
    setActivePinia(createPinia());
  });

  function seedTwoItems() {
    const store = useAgentProcessesStore();
    store.ensureSession(SESSION);
    store.noteToolStart(SESSION, "call-1", "runTerminal", { command: "npm run dev" });
    store.noteToolStart(SESSION, "call-2", "runTerminal", { command: "vite" });
    return store;
  }

  it("remove 移除指定条目并收起其展开态", () => {
    const store = seedTwoItems();
    store.toggle("call-1");
    expect(store.expandedId).toBe("call-1");

    store.remove("call-1");
    expect(store.items.map((item) => item.id)).toEqual(["call-2"]);
    expect(store.expandedId).toBe("");
  });

  it("移除运行中的条目后，后续 progress/end 事件静默跳过", () => {
    const store = seedTwoItems();
    store.remove("call-1");

    store.noteToolProgress(SESSION, {
      toolCallId: "call-1",
      toolName: "runTerminal",
      message: "运行中",
      outputTail: "tail output",
    });
    store.noteToolEnd(SESSION, "call-1", "runTerminal", {
      ok: true,
      summary: "工具执行完成",
      output: { output: "done", exitCode: 0 },
    });
    expect(store.items.map((item) => item.id)).toEqual(["call-2"]);
    expect(store.items[0]!.status).toBe("running");
  });

  it("toggle 反复点击同一 id 收起/展开", () => {
    const store = seedTwoItems();
    store.toggle("call-2");
    expect(store.expandedId).toBe("call-2");
    store.toggle("call-2");
    expect(store.expandedId).toBe("");
  });
});
