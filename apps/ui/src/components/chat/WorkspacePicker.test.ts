import { mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import WorkspacePicker from "@/components/chat/WorkspacePicker.vue";
import { useChatStore } from "@/stores/chat";
import { useWorkspaceStore } from "@/stores/workspace";

let pinia: ReturnType<typeof createPinia>;

beforeEach(() => {
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
  vi.stubGlobal("zen", {
    session: { setWorkspace: vi.fn(), create: vi.fn(), setDraft: vi.fn() },
    workspace: {
      list: vi.fn().mockResolvedValue([
        { id: "common", name: "公共区", kind: "common", path: null, archived: false, sessions: [] },
        {
          id: "ws-a",
          name: "项目 A",
          kind: "workspace",
          path: "/tmp/project-a",
          archived: false,
          sessions: [],
        },
      ]),
      create: vi.fn().mockResolvedValue(null),
    },
  });
});

afterEach(() => {
  disposePinia(pinia);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("WorkspacePicker", () => {
  it("stays visible in compact bar and exposes current run directory", async () => {
    const chat = useChatStore();
    const workspace = useWorkspaceStore();
    await workspace.refresh();
    await chat.setSessionWorkspace("ws-a");

    const wrapper = mount(WorkspacePicker, {
      props: { compact: true },
      attachTo: document.body,
    });

    const trigger = wrapper.get("button");
    expect(trigger.isVisible()).toBe(true);
    expect(trigger.attributes("aria-label")).toContain("项目 A");
    expect(trigger.attributes("title")).toContain("项目 A");
    wrapper.unmount();
  });

  it("stays visible with full label in non-compact bar", async () => {
    const chat = useChatStore();
    const workspace = useWorkspaceStore();
    await workspace.refresh();
    await chat.setSessionWorkspace("common");

    const wrapper = mount(WorkspacePicker, {
      props: { compact: false },
      attachTo: document.body,
    });

    const trigger = wrapper.get("button");
    expect(trigger.isVisible()).toBe(true);
    expect(trigger.text()).toContain("公共区");
    wrapper.unmount();
  });

  it("pick updates sessionWorkspaceId to the selected workspace", async () => {
    const chat = useChatStore();
    const workspace = useWorkspaceStore();
    await workspace.refresh();

    const wrapper = mount(WorkspacePicker, {
      props: { compact: false },
      attachTo: document.body,
    });

    await wrapper.get("button").trigger("click");
    const items = document.querySelectorAll("[role='menuitem']");
    const target = [...items].find((item) => item.textContent?.includes("项目 A"));
    expect(target).toBeTruthy();
    (target as HTMLElement).click();
    await Promise.resolve();
    await Promise.resolve();

    expect(chat.sessionWorkspaceId).toBe("ws-a");
    wrapper.unmount();
  });
});
