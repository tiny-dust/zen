import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

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

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
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
    const wrapper = mount(MemorySection, { attachTo: document.body });
    await flushPromises();

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
