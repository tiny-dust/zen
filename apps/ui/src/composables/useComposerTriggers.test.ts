import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useComposerTriggers } from "@/composables/useComposerTriggers";
import { useAgentStore } from "@/stores/agent";

import type { McpServerStatus } from "@zen/shared";

let pinia: ReturnType<typeof createPinia>;
let value: string;
let caretAt: number;
let setValue: (next: string) => void;
let setCaret: (offset: number) => void;
let focus: () => void;
let listFiles: ReturnType<typeof vi.fn>;
let triggers: ReturnType<typeof useComposerTriggers>;

/** 模拟在光标处输入文本后触发补全检测 */
function type(text: string): void {
  value = value.slice(0, caretAt) + text + value.slice(caretAt);
  caretAt += text.length;
  triggers.evaluate();
}

function statusOf(
  config: McpServerStatus["config"],
  patch: Partial<Omit<McpServerStatus, "config">> = {},
): McpServerStatus {
  return { config, state: "stopped", tools: [], ...patch };
}

const mobbinStatus: McpServerStatus = statusOf(
  { id: "srv-1", name: "mobbin", transport: "http", url: "https://mcp.example.com", enabled: true },
  {
    state: "running",
    tools: [
      {
        serverId: "srv-1",
        name: "search_apps",
        description: "搜索应用",
        inputSchema: { type: "object" },
      },
      {
        serverId: "srv-1",
        name: "get_screenshots",
        description: "",
        inputSchema: { type: "object" },
      },
    ],
  },
);

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  value = "";
  caretAt = 0;
  setValue = vi.fn((next: string) => {
    value = next;
  });
  setCaret = vi.fn((offset: number) => {
    caretAt = offset;
  });
  focus = vi.fn();
  listFiles = vi.fn().mockResolvedValue([]);
  vi.stubGlobal("zen", {
    agent: { listSkills: vi.fn().mockResolvedValue([]) },
    mcp: { list: vi.fn().mockResolvedValue([]) },
    workspace: { listFiles },
  });
  triggers = useComposerTriggers({
    caret: () => caretAt,
    value: () => value,
    setValue,
    setCaret,
    focus,
  });
});

afterEach(() => {
  disposePinia(pinia);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useComposerTriggers # MCP 工具菜单", () => {
  it("裸 # 触发：空输入打下 # 后打开 mcp 菜单", () => {
    type("#");
    expect(triggers.open.value).toBe(true);
    expect(triggers.kind.value).toBe("mcp");
  });

  it("菜单只列 running 服务的工具，insert 为完整 #mcp:服务.工具 token", () => {
    const broken = statusOf(
      { id: "srv-2", name: "broken", transport: "stdio", command: "b", args: [], enabled: true },
      {
        state: "error",
        error: "spawn ENOENT",
        tools: [{ serverId: "srv-2", name: "boom", description: "", inputSchema: { type: "object" } }],
      },
    );
    useAgentStore().mcpStatuses = [mobbinStatus, broken];

    type("#");
    expect(triggers.kind.value).toBe("mcp");
    const inserts = triggers.items.value.map((item) => item.insert);
    expect(inserts).toHaveLength(2);
    expect(inserts).toContain("#mcp:mobbin.search_apps ");
    expect(inserts).toContain("#mcp:mobbin.get_screenshots ");
    expect(triggers.items.value.every((item) => item.serverName === "mobbin")).toBe(true);
  });

  it("输入 #sea 后按模糊打分过滤命中 search_apps", () => {
    useAgentStore().mcpStatuses = [mobbinStatus];

    type("#sea");
    expect(triggers.kind.value).toBe("mcp");
    expect(triggers.items.value.map((item) => item.label)).toEqual(["search_apps"]);
  });

  it("apply 插入带尾随空格的 token 并收起菜单", () => {
    useAgentStore().mcpStatuses = [mobbinStatus];

    type("#sea");
    expect(triggers.apply(triggers.activeItem.value)).toBe(true);
    expect(setValue).toHaveBeenCalledWith("#mcp:mobbin.search_apps ");
    expect(value).toBe("#mcp:mobbin.search_apps ");
    expect(caretAt).toBe("#mcp:mobbin.search_apps ".length);
    expect(triggers.open.value).toBe(false);
    expect(focus).toHaveBeenCalled();
  });

  it("完整 #mcp: token 光标紧跟其后时守卫生效不再唤起", () => {
    value = "#mcp:mobbin.search_apps";
    caretAt = value.length;

    triggers.evaluate();
    expect(triggers.open.value).toBe(false);
  });

  it("@ 文件触发不受影响", async () => {
    type("@");
    expect(triggers.open.value).toBe(true);
    expect(triggers.kind.value).toBe("file");
    await vi.waitFor(() => {
      expect(listFiles).toHaveBeenCalled();
    });
  });
});
