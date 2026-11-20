import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkflowDialog from "@/components/workflow/WorkflowDialog.vue";
import { useChatStore } from "@/stores/chat";

import type { WorkflowRunSummary } from "@/types/zen-api";

/**
 * 工作流面板：草稿会话（还没落库）不能去查运行记录，否则主进程返回
 * 「Session not found」；说明文案收进标题旁的悬浮 icon，运行记录走单独 tab。
 */

const sessionSnapshot = vi.fn();
const listRuns = vi.fn();
const list = vi.fn();

function runFixture(patch: Partial<WorkflowRunSummary> = {}): WorkflowRunSummary {
  return {
    id: "run-1a2b3c4d",
    workflow_id: "wf-1",
    version: 3,
    session_id: "s-1",
    status: "completed",
    detail: null,
    created_at: 1,
    updated_at: 1,
    ...patch,
  };
}

function stubZen() {
  sessionSnapshot.mockReset().mockResolvedValue(null);
  listRuns.mockReset().mockResolvedValue([]);
  list.mockReset().mockResolvedValue([]);
  vi.stubGlobal("zen", {
    session: { snapshot: sessionSnapshot, create: vi.fn().mockResolvedValue({}) },
    workflow: {
      list,
      listRuns,
      listTools: vi.fn().mockResolvedValue([]),
      open: vi.fn().mockResolvedValue(null),
      save: vi.fn(),
      start: vi.fn(),
      get: vi.fn(),
      resume: vi.fn(),
      cancel: vi.fn(),
      review: vi.fn(),
    },
  });
}

function mountPanel() {
  return mount(WorkflowDialog, {
    props: { active: true },
    global: {
      stubs: {
        WorkflowEditor: true,
        ConfirmDialog: true,
        Select: { template: "<div><slot /></div>" },
        SelectTrigger: { template: "<div><slot /></div>" },
        SelectValue: true,
        SelectContent: { template: "<div><slot /></div>" },
        SelectItem: { template: "<div><slot /></div>" },
      },
    },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("WorkflowDialog", () => {
  it("草稿会话不查询运行记录，也不弹 Session not found", async () => {
    vi.useFakeTimers();
    stubZen();
    listRuns.mockRejectedValue(new Error("Error invoking remote method 'workflow:list-runs': Error: Session not found"));

    const wrapper = mountPanel();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(2000);
    await flushPromises();

    expect(useChatStore().sessionId).toBeTruthy();
    expect(sessionSnapshot).toHaveBeenCalled();
    expect(listRuns).not.toHaveBeenCalled();
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("会话落库后进入运行记录 tab 能看到最近运行", async () => {
    vi.useFakeTimers();
    stubZen();
    sessionSnapshot.mockResolvedValue({ session: {}, messages: [] });
    listRuns.mockResolvedValue([runFixture()]);

    const wrapper = mountPanel();
    await flushPromises();

    expect(listRuns).toHaveBeenCalledWith(useChatStore().sessionId);

    const runsTab = wrapper.findAll('[role="tab"]').find((tab) => tab.text() === "运行记录");
    expect(runsTab).toBeTruthy();
    await runsTab!.trigger("click");
    expect(wrapper.text()).toContain("run-1a2b");

    wrapper.unmount();
  });

  it("顶部说明收进标题旁的悬浮 icon，编辑器 tab 直接展示工具栏", () => {
    stubZen();
    const wrapper = mountPanel();

    expect(wrapper.find('button[aria-label="工作流入门"]').exists()).toBe(true);
    expect(wrapper.text()).not.toContain("编辑图谱并保存版本，然后在当前会话中手动启动。");
    expect(wrapper.findAll('[role="tab"]').map((tab) => tab.text())).toEqual(["编辑器", "运行记录"]);
    expect(wrapper.find("#workflow-name").exists()).toBe(true);

    wrapper.unmount();
  });
});
