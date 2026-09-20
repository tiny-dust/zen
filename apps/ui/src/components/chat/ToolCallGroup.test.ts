import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import ToolCallGroup from "./ToolCallGroup.vue";
import ToolCallRow from "./ToolCallRow.vue";
import type { ToolPart } from "./tool-part";

const revealFile = vi.hoisted(() => vi.fn());
vi.mock("@/stores/right-panel", () => ({ useRightPanelStore: () => ({ revealFile }) }));
afterEach(() => vi.clearAllMocks());

const terminal: ToolPart = {
  type: "tool", toolCallId: "terminal", toolName: "runTerminal", state: "ok",
  args: { command: "pnpm test\npnpm build", cwd: "/workspace" }, output: "all checks passed",
};

function visibleDetails(wrapper: ReturnType<typeof mount>) {
  return wrapper.findAll("pre").filter((node) => node.isVisible());
}

describe("ToolCallGroup", () => {
  it("starts collapsed and exposes terminal output only through nested disclosure", async () => {
    const wrapper = mount(ToolCallGroup, { props: { tools: [terminal] } });
    expect(wrapper.get(".tool-group-trigger").attributes("aria-expanded")).toBe("false");
    expect(wrapper.text()).toContain("执行终端 1");
    expect(visibleDetails(wrapper)).toHaveLength(0);
    await wrapper.get(".tool-group-trigger").trigger("click");
    expect(wrapper.get(".tool-group-trigger").attributes("aria-expanded")).toBe("true");
    expect(visibleDetails(wrapper)).toHaveLength(0);
    await wrapper.get(".tool-action").trigger("click");
    expect(wrapper.get("pre").text()).toBe("all checks passed");
    expect(wrapper.text()).not.toContain("pnpm test");
    expect(wrapper.text()).not.toContain("参数");
    await wrapper.get(".tool-action").trigger("click");
    expect(visibleDetails(wrapper)).toHaveLength(0);
    wrapper.unmount();
  });

  it("keeps the user's disclosure choice while tools stream into the group", async () => {
    const wrapper = mount(ToolCallGroup, { props: { tools: [{ ...terminal, state: "running" }] } });
    await wrapper.get(".tool-group-trigger").trigger("click");
    await wrapper.setProps({ tools: [terminal, { ...terminal, toolCallId: "second", state: "error" }] });
    expect(wrapper.get(".tool-group-trigger").attributes("aria-expanded")).toBe("true");
    expect(wrapper.get(".tool-group-trigger").text()).toContain("失败 1");
    await wrapper.get(".tool-group-trigger").trigger("click");
    await wrapper.setProps({ tools: [terminal] });
    expect(wrapper.get(".tool-group-trigger").attributes("aria-expanded")).toBe("false");
    wrapper.unmount();
  });
});

describe("ToolCallRow", () => {
  it("uses a file link that opens the full path without opening the details", async () => {
    const wrapper = mount(ToolCallRow, { props: { part: {
      type: "tool", toolCallId: "read", toolName: "readFile", state: "ok",
      args: { path: "apps/ui/src/App.vue" }, output: "file contents",
    } } });
    expect(wrapper.get(".file-label").text()).toBe("apps/ui/src/App.vue");
    expect(wrapper.get(".tool-range").text()).toBe("L1");
    expect(wrapper.get(".tool-file-target").attributes("title")).toBe("apps/ui/src/App.vue");
    expect(wrapper.find("button button").exists()).toBe(false);
    await wrapper.get(".tool-file-target").trigger("click");
    expect(revealFile).toHaveBeenCalledWith("apps/ui/src/App.vue");
    expect(wrapper.get(".tool-action").attributes("aria-expanded")).toBe("false");
    wrapper.unmount();
  });
});
