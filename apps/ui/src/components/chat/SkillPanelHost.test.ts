import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";

import SkillPanelHost from "@/components/chat/SkillPanelHost.vue";
import { useSkillUsageStore } from "@/stores/skill-usage";

import type { ChatMessage, SkillPanelInfo } from "@zen/shared";

const chatState = vi.hoisted(() => ({
  sessionId: "s1",
  messages: [] as ChatMessage[],
  lastInputTokens: null as number | null,
  lastOutputTokens: null as number | null,
  cacheHitRate: null as number | null,
}));

const agentState = vi.hoisted(() => ({
  skills: [{ id: "/skills/skill-router", name: "skill-router", dir: "/skills/skill-router" }],
  skillPanel: vi.fn(),
}));

vi.mock("@/stores/chat", () => ({ useChatStore: () => chatState }));
vi.mock("@/stores/agent", () => ({ useAgentStore: () => agentState }));

function panel(overrides: Partial<SkillPanelInfo["manifest"]> = {}, html?: string): SkillPanelInfo {
  return {
    dir: "/skills/skill-router",
    manifest: {
      version: 1,
      title: "skill-router",
      showOnSkillUse: true,
      metrics: ["rounds", "tools"],
      ...overrides,
    },
    html,
  };
}

async function mountWithPanel(info: SkillPanelInfo | null) {
  agentState.skillPanel.mockResolvedValueOnce(info);
  chatState.messages = [
    { id: "u1", role: "user", content: "", createdAt: 0 },
    {
      id: "a1",
      role: "assistant",
      content: "",
      createdAt: 10,
      parts: [{ type: "tool", toolCallId: "t1", toolName: "readFile", state: "ok" }],
    },
  ];
  useSkillUsageStore().noteSkills("s1", ["skill-router"]);
  const wrapper = mount(SkillPanelHost);
  await flushPromises();
  return wrapper;
}

describe("SkillPanelHost 技能面板", () => {
  it("技能声明了 panel.json 时渲染内置指标行", async () => {
    const wrapper = await mountWithPanel(panel());
    expect(wrapper.text()).toContain("skill-router");
    expect(wrapper.text()).toContain("1 轮");
    expect(wrapper.text()).toContain("1 次工具");
  });

  it("Ponytail band 使用宿主指标行而不是依赖内联脚本", async () => {
    chatState.lastInputTokens = 1200;
    chatState.lastOutputTokens = 300;
    const wrapper = await mountWithPanel(panel({ title: "Ponytail band", metrics: ["rounds", "tools", "tokens"] }));
    expect(wrapper.find("iframe").exists()).toBe(false);
    expect(wrapper.text()).toContain("Ponytail band");
    expect(wrapper.text()).toContain("输入 1.2K / 输出 300");
    chatState.lastInputTokens = null;
    chatState.lastOutputTokens = null;
  });

  it("技能没有 panel.json 时不渲染任何面板", async () => {
    const wrapper = await mountWithPanel(null);
    expect(wrapper.text()).toBe("");
  });

  it("声明 ui 时用沙箱 iframe 渲染技能自带看板", async () => {
    const wrapper = await mountWithPanel(panel({ ui: "ui/panel.html" }, "<p>panel</p>"));
    const frame = wrapper.find("iframe");
    expect(frame.exists()).toBe(true);
    expect(frame.attributes("sandbox")).toBe("allow-scripts");
    expect(frame.attributes("srcdoc")).toBe("<p>panel</p>");
  });
});
