import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  skills: [{ id: "/skills/demo-skill", name: "demo-skill", dir: "/skills/demo-skill" }],
  skillPanel: vi.fn(),
}));

vi.mock("@/stores/chat", () => ({ useChatStore: () => chatState }));
vi.mock("@/stores/agent", () => ({ useAgentStore: () => agentState }));

function panel(overrides: Partial<SkillPanelInfo["manifest"]> = {}, html?: string): SkillPanelInfo {
  return {
    dir: "/skills/demo-skill",
    manifest: {
      version: 1,
      title: "demo-skill",
      showOnSkillUse: true,
      metrics: ["rounds", "tools"],
      ...overrides,
    },
    html,
  };
}

async function mountWithPanel(info: SkillPanelInfo | null, skillName = "demo-skill") {
  agentState.skillPanel.mockResolvedValue(info);
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
  useSkillUsageStore().noteSkills("s1", [skillName]);
  const wrapper = mount(SkillPanelHost);
  await flushPromises();
  return wrapper;
}

describe("SkillPanelHost 技能面板", () => {
  // 面板信息按目录缓存（pinia store 跨用例存活），每个用例换成全新的 pinia 避免串味
  beforeEach(() => {
    setActivePinia(createPinia());
    agentState.skillPanel.mockReset();
  });

  it("技能声明了 panel.json 时渲染内置指标行", async () => {
    const wrapper = await mountWithPanel(panel());
    expect(wrapper.text()).toContain("demo-skill");
    expect(wrapper.text()).toContain("1 轮");
    expect(wrapper.text()).toContain("1 次工具");
  });

  it("Ponytail 与 skill-router 的信息栏不再渲染，即使目录里还留着 panel.json", async () => {
    const ponytail = await mountWithPanel(
      panel({ title: "Ponytail band", metrics: ["rounds", "tools", "tokens"] }),
      "ponytail",
    );
    expect(ponytail.text()).toBe("");
    expect(ponytail.find("iframe").exists()).toBe(false);

    const router = await mountWithPanel(panel({ title: "skill-router" }), "skill-router");
    expect(router.text()).toBe("");
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
