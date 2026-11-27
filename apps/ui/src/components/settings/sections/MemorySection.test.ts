import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useChatStore } from "@/stores/chat";
import { Select } from "@/components/ui/select";

import MemorySection from "./MemorySection.vue";

const note = { id: "note-1", text: "Remember this", createdAt: 1 };
const provider = {
  id: "provider-1",
  name: "Test Provider",
  enabled: true,
  hasApiKey: true,
  models: [{ id: "model-1", name: "Test Model", enabled: true }],
};

const episode = {
  id: "ep-1",
  sessionId: "session-1",
  workspaceId: "common",
  title: "Kickoff",
  summary: "Discussed the migration plan",
  keywords: ["plan", "migration"],
  messageCount: 4,
  pinned: false,
  edited: false,
  createdAt: 1,
  updatedAt: 2,
};

const fact = {
  id: "fact-1",
  kind: "preference",
  text: "Prefers small diffs",
  source: "auto",
  pinned: false,
  createdAt: 1,
  updatedAt: 2,
};

const enabledSettings = {
  enabled: true,
  autoSummarize: true,
  autoExtractFacts: false,
  recall: true,
  topK: 3,
  model: null,
};

/** 固定一套对话记忆桥：各用例只覆盖自己关心的方法 */
function createConversationBridge(overrides: Record<string, unknown> = {}) {
  return {
    state: vi.fn().mockResolvedValue({
      settings: enabledSettings,
      stats: { episodes: 1, facts: 1, personaChars: 6 },
      lastError: "",
    }),
    list: vi.fn().mockResolvedValue({ episodes: [episode], facts: [fact] }),
    ingest: vi.fn().mockResolvedValue({ ok: true, factsAdded: 0, episode }),
    updateEpisode: vi.fn().mockResolvedValue({ episodes: [episode], facts: [fact] }),
    upsertFact: vi.fn().mockResolvedValue({ episodes: [episode], facts: [fact] }),
    remove: vi.fn().mockResolvedValue({ episodes: [], facts: [fact] }),
    persona: vi.fn().mockResolvedValue("Backend engineer"),
    setPersona: vi.fn().mockResolvedValue({ ok: true }),
    setSettings: vi.fn().mockResolvedValue({
      settings: enabledSettings,
      stats: { episodes: 1, facts: 1, personaChars: 6 },
      lastError: "",
    }),
    exportAll: vi.fn().mockResolvedValue({ ok: true, path: "/tmp/memory-export.json" }),
    clear: vi.fn().mockResolvedValue({ episodes: [], facts: [] }),
    onChanged: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

function stubZen(conversations: Record<string, unknown>) {
  vi.stubGlobal("zen", {
    models: { list: vi.fn().mockResolvedValue([provider]) },
    memory: {
      get: vi.fn().mockResolvedValue({
        user: { notes: [note] },
        device: { groups: [], tools: {}, collectedAt: 1, platform: "darwin", arch: "arm64", home: "/tmp", shell: "/bin/zsh", locale: "zh-CN", timezone: "Asia/Shanghai" },
      }),
      conversations,
    },
  });
}

async function mountSection() {
  const wrapper = mount(MemorySection, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

/** reka 的 TabsTrigger 在 mousedown 时激活页签（不是 click） */
async function openTab(wrapper: Awaited<ReturnType<typeof mountSection>>, id: string) {
  await wrapper.get(`[data-testid="mem-tab-${id}"]`).trigger("mousedown");
  await flushPromises();
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MemorySection long-term memory tabs", () => {
  it("renders the five tabs and keeps device memory in its own tab", async () => {
    stubZen(createConversationBridge());
    const wrapper = await mountSection();

    for (const id of ["episodes", "facts", "persona", "device", "settings"]) {
      expect(wrapper.find(`[data-testid="mem-tab-${id}"]`).exists()).toBe(true);
    }
    // 默认对话记忆页签：展示摘要卡片
    expect(wrapper.text()).toContain("Kickoff");
    expect(wrapper.text()).toContain("Discussed the migration plan");

    await openTab(wrapper, "device");
    expect(wrapper.text()).toContain("设备环境快照");
    expect(wrapper.text()).toContain("Remember this");
    wrapper.unmount();
  });

  it("disables dependent switches while long-term memory is off", async () => {
    stubZen(
      createConversationBridge({
        state: vi.fn().mockResolvedValue({
          settings: { ...enabledSettings, enabled: false },
          stats: { episodes: 0, facts: 0, personaChars: 0 },
          lastError: "",
        }),
      }),
    );
    const wrapper = await mountSection();

    await openTab(wrapper, "settings");

    const enabled = wrapper.get('[data-testid="mem-switch-enabled"]');
    expect(enabled.attributes("disabled")).toBeUndefined();
    for (const id of ["auto-summarize", "auto-extract", "recall"]) {
      expect(wrapper.get(`[data-testid="mem-switch-${id}"]`).attributes("disabled")).toBeDefined();
    }
    // 关闭态提示条带一键开启
    expect(wrapper.text()).toContain("长期记忆已关闭");
    wrapper.unmount();
  });

  it("summarizes the current conversation with force", async () => {
    const ingest = vi.fn().mockResolvedValue({ ok: true, factsAdded: 1, episode });
    stubZen(createConversationBridge({ ingest }));
    const wrapper = await mountSection();

    const chat = useChatStore();
    chat.messages.push(
      { id: "m1", role: "user", content: "  plan the migration  ", createdAt: 1 },
      { id: "m2", role: "assistant", content: "", createdAt: 2 },
      { id: "m3", role: "assistant", content: "here is the plan", createdAt: 3 },
      { id: "m4", role: "user", content: "failed", createdAt: 4, meta: { error: "boom" } },
    );

    await wrapper.get('[data-testid="mem-summarize"]').trigger("click");
    await flushPromises();

    expect(ingest).toHaveBeenCalledOnce();
    const [sessionId, messages, options] = ingest.mock.calls[0]!;
    expect(sessionId).toBe(chat.sessionId);
    expect(messages).toEqual([
      { role: "user", content: "plan the migration" },
      { role: "assistant", content: "here is the plan" },
    ]);
    expect(options).toEqual({ force: true });
    wrapper.unmount();
  });

  it("tells the user when the conversation is too short", async () => {
    stubZen(
      createConversationBridge({
        ingest: vi.fn().mockResolvedValue({ ok: true, factsAdded: 0, skipped: "too-short" }),
      }),
    );
    const wrapper = await mountSection();

    const chat = useChatStore();
    chat.messages.push({ id: "m1", role: "user", content: "hi", createdAt: 1 });

    await wrapper.get('[data-testid="mem-summarize"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("这段对话还太短");
    wrapper.unmount();
  });

  it("asks for confirmation before deleting an episode", async () => {
    const remove = vi.fn().mockResolvedValue({ episodes: [], facts: [fact] });
    stubZen(createConversationBridge({ remove }));
    const wrapper = await mountSection();

    await wrapper.get('[data-testid="mem-episode-delete"]').trigger("click");
    await flushPromises();
    expect(remove).not.toHaveBeenCalled();

    const confirm = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
      (button) => button.textContent?.trim() === "删除",
    );
    expect(confirm).toBeTruthy();
    confirm!.click();
    await flushPromises();

    expect(remove).toHaveBeenCalledWith("episode", "ep-1");
    wrapper.unmount();
  });

  it("shows the export path after exporting", async () => {
    const exportAll = vi.fn().mockResolvedValue({ ok: true, path: "/tmp/memory-export.json" });
    stubZen(createConversationBridge({ exportAll }));
    const wrapper = await mountSection();

    await openTab(wrapper, "settings");
    await wrapper.get('[data-testid="mem-export-json"]').trigger("click");
    await flushPromises();

    expect(exportAll).toHaveBeenCalledWith("json");
    expect(wrapper.get('[data-testid="mem-export-path"]').text()).toContain("/tmp/memory-export.json");
    wrapper.unmount();
  });

  it("debounces the search box into list(query)", async () => {
    const list = vi.fn().mockResolvedValue({ episodes: [episode], facts: [fact] });
    stubZen(createConversationBridge({ list }));
    const wrapper = await mountSection();

    expect(list).toHaveBeenCalledWith(undefined);
    list.mockClear();

    await wrapper.get('[data-testid="mem-search"]').setValue("migration");
    await new Promise((resolve) => setTimeout(resolve, 350));
    await flushPromises();

    expect(list).toHaveBeenCalledWith("migration");
    wrapper.unmount();
  });

  it("refreshes when the main process broadcasts a change", async () => {
    let changed: (() => void) | undefined;
    const onChanged = vi.fn((handler: () => void) => {
      changed = handler;
      return () => {};
    });
    const list = vi.fn().mockResolvedValue({ episodes: [episode], facts: [fact] });
    stubZen(createConversationBridge({ list, onChanged }));
    const wrapper = await mountSection();

    expect(onChanged).toHaveBeenCalledOnce();
    list.mockClear();

    changed?.();
    await flushPromises();

    expect(list).toHaveBeenCalledOnce();
    wrapper.unmount();
  });
});

describe("MemorySection consolidation model selection", () => {
  it("waits for a model choice before requesting a preview", async () => {
    const list = vi.fn().mockResolvedValue([provider, { ...provider, id: "provider-2", name: "Second Provider" }]);
    const consolidatePreview = vi.fn().mockResolvedValue({
      ok: true,
      before: [note],
      after: [note],
      changedCount: 0,
    });
    vi.stubGlobal("zen", {
      models: { list },
      memory: {
        get: vi.fn().mockResolvedValue({ user: { notes: [note] }, device: { groups: [] } }),
        consolidatePreview,
      },
    });
    const wrapper = await mountSection();

    await openTab(wrapper, "device");

    await wrapper.findAll("button").filter((button) => button.text().trim() === "整固")[1]!.trigger("click");
    await flushPromises();
    expect(list).toHaveBeenCalledOnce();
    expect(consolidatePreview).not.toHaveBeenCalled();

    const preview = [...document.querySelectorAll("button")].find((button) => button.textContent?.trim() === "生成预览")!;
    expect(preview.disabled).toBe(true);
    wrapper.findAllComponents(Select)[1]!.vm.$emit("update:modelValue", JSON.stringify(["provider-2", "model-1"]));
    await flushPromises();
    expect(preview.disabled).toBe(false);
    preview.click();
    await flushPromises();
    expect(consolidatePreview).toHaveBeenCalledWith("user", "provider-2", "model-1");
    wrapper.unmount();
  });
});
