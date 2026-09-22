import { mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { defineComponent, h, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ComposerEditor from "@/components/chat/ComposerEditor.vue";
import { useComposerTriggers } from "@/composables/useComposerTriggers";
import { useAgentStore } from "@/stores/agent";
import { useChatStore } from "@/stores/chat";
import { useModelsStore } from "@/stores/models";
import { useUserStore } from "@/stores/user";

let pinia: ReturnType<typeof createPinia>;
let wrapper: ReturnType<typeof mount> | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  pinia = createPinia();
  setActivePinia(pinia);
});

afterEach(() => {
  wrapper?.unmount();
  wrapper = undefined;
  disposePinia(pinia);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("composer skill selection", () => {
  it.each([false, true])("renders and sends a skill token (scanned: %s)", async (scanned) => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("zen", {
      agent: { run },
      session: { rename: vi.fn(), setDraft: vi.fn() },
    });
    if (scanned) {
      useAgentStore().skills = [{
        id: "coder", name: "coder", description: "Code tasks", dir: "/skills/coder", source: "user", removable: true, disabled: false,
      }];
    }
    useUserStore().auth.loggedIn = true;
    useModelsStore().selection = { providerId: "test-provider", modelId: "test-model" };
    const chat = useChatStore();
    chat.input = "/";
    const name = scanned ? "coder" : "commit-helper";

    wrapper = mount(defineComponent({
      setup() {
        const editor = ref<InstanceType<typeof ComposerEditor> | null>(null);
        const triggers = useComposerTriggers({
          caret: () => chat.input.length,
          value: () => chat.input,
          setValue: (value) => { chat.input = value; },
          setCaret: (offset) => editor.value?.setCaretSoon(offset),
          focus: () => editor.value?.focus(),
        });
        triggers.evaluate();
        return () => h("div", [
          h(ComposerEditor, {
            ref: editor,
            modelValue: chat.input,
            attachments: [],
            "onUpdate:modelValue": (value: string) => { chat.input = value; },
          }),
          ...triggers.items.value.map((item) => h("button", {
            type: "button",
            onClick: () => triggers.apply(item),
          }, item.label)),
        ]);
      },
    }), { global: { plugins: [pinia] } });

    await wrapper.get("button").trigger("click");
    expect(chat.input).toBe(`/skill:${name} `);
    expect(wrapper.get(".composer-token-skill .composer-token-name").text()).toBe(name);
    expect(wrapper.get(".composer-editor").element.textContent).toBe(chat.input);

    await chat.send();
    await nextTick();
    expect(run).toHaveBeenCalledWith(expect.objectContaining({ userMessage: `/skill:${name}` }));
    expect(chat.messages[0]).toMatchObject({
      role: "user",
      content: `/skill:${name}`,
      meta: { skills: [{ name }] },
    });
    expect(wrapper.find(".composer-token-skill").exists()).toBe(false);
  });
});
