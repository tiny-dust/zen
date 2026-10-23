import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentServiceInfo } from "@zen/shared";

import { useAgentServicesStore } from "./agent-services";

function service(id: string): AgentServiceInfo {
  return {
    id,
    sessionId: "session-1",
    label: "npm run dev",
    command: "npm run dev",
    cwd: "/tmp/project",
    startedAt: Date.now(),
    pids: [101, 102],
  };
}

describe("useAgentServicesStore 详情展开", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("toggle 展开与收起", () => {
    const store = useAgentServicesStore();
    store.items = [service("a")];

    store.toggle("a");
    expect(store.expandedId).toBe("a");
    store.toggle("a");
    expect(store.expandedId).toBe("");
  });

  it("展开的服务从清单移除后自动收起（refresh 推送刷新）", async () => {
    vi.stubGlobal("zen", undefined);
    const store = useAgentServicesStore();
    store.items = [service("a"), service("b")];
    store.toggle("a");

    vi.stubGlobal("zen", {
      services: {
        onChange: () => () => undefined,
        list: async () => [service("b")],
      },
    });
    await store.refresh();

    expect(store.items.map((item) => item.id)).toEqual(["b"]);
    expect(store.expandedId).toBe("");
  });

  it("kill 无 IPC 桥时返回错误，不影响展开态", async () => {
    vi.stubGlobal("zen", undefined);
    const store = useAgentServicesStore();
    store.items = [service("a")];
    store.toggle("a");

    const result = await store.kill("a");
    expect(result.ok).toBe(false);
    expect(store.items.map((item) => item.id)).toEqual(["a"]);
    expect(store.expandedId).toBe("a");
  });
});
