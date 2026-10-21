// 异常中心面板挂载：空态文案 / 列表渲染（消息、×N、来源 Badge、分析结果）。
import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ErrorsPanel from "@/components/right/ErrorsPanel.vue";
import { useErrorsStore } from "@/stores/errors";

import type { ErrorReportRecord } from "@zen/shared";

function recordOf(id: string, patch: Partial<ErrorReportRecord> = {}): ErrorReportRecord {
  return {
    id,
    source: "renderer",
    kind: "window-error",
    message: `boom ${id}`,
    firstSeenAt: 1,
    lastSeenAt: 2,
    count: 1,
    ...patch,
  };
}

const listMock = vi.fn(async (): Promise<ErrorReportRecord[]> => []);
const analyzeMock = vi.fn(async () => null);
const clearMock = vi.fn(async () => ({ ok: true }));

function stubErrorsZen() {
  listMock.mockReset();
  analyzeMock.mockReset();
  clearMock.mockReset();
  vi.stubGlobal("zen", {
    errors: {
      list: listMock,
      analyze: analyzeMock,
      clear: clearMock,
      report: vi.fn(async () => ({ ok: true })),
      onChanged: vi.fn(() => () => undefined),
    },
  });
}

async function mountPanel() {
  const wrapper = mount(ErrorsPanel);
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  setActivePinia(createPinia());
  stubErrorsZen();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("ErrorsPanel", () => {
  it("空列表渲染平静空态与收集说明", async () => {
    listMock.mockResolvedValue([]);
    const wrapper = await mountPanel();
    expect(wrapper.text()).toContain("暂无异常");
    expect(wrapper.text()).toContain("软件运行时的报错会自动收集到这里");
  });

  it("列表渲染消息 / 来源 Badge / 类型与次数", async () => {
    listMock.mockResolvedValue([
      recordOf("r1", { count: 3, source: "main", kind: "uncaught" }),
      recordOf("r2", { message: "TypeError: cannot read" }),
    ]);
    const wrapper = await mountPanel();
    const text = wrapper.text();
    expect(text).toContain("boom r1");
    expect(text).toContain("TypeError: cannot read");
    expect(text).toContain("主进程");
    expect(text).toContain("渲染层");
    expect(text).toContain("×3");
    // count=1 不显示次数
    expect(text).not.toContain("×1");
  });

  it("分析结果 inline 展示，软件相关时出现修复按钮", async () => {
    listMock.mockResolvedValue([recordOf("r1")]);
    const wrapper = await mountPanel();
    const store = useErrorsStore();
    store.analysisMap["r1"] = { softwareRelated: true, confidence: "high", reason: "堆栈指向 Zen 自身代码" };
    await flushPromises();
    expect(wrapper.text()).toContain("软件相关");
    expect(wrapper.text()).toContain("堆栈指向 Zen 自身代码");
    expect(wrapper.text()).toContain("置信度高");
    expect(wrapper.text()).toContain("修复");
  });
});
