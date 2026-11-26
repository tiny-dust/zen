import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import FileViewer from "./FileViewer.vue";

vi.mock("@/composables/useAppTheme", () => ({
  useAppTheme: () => ({ isDark: ref(false) }),
}));

describe("FileViewer absolute paths without a workspace", () => {
  it("previews a referenced file in read-only mode", async () => {
    const readFile = vi.fn().mockResolvedValue(null);
    const previewFile = vi.fn().mockResolvedValue({ kind: "text", content: "hello", truncated: false });
    (window as unknown as { zen: unknown }).zen = { workspace: { readFile, previewFile } };
    const wrapper = mount(FileViewer, { props: { path: "/tmp/output.txt" } });
    await flushPromises();
    expect(previewFile).toHaveBeenCalledWith(undefined, "/tmp/output.txt");
    expect(wrapper.text()).toContain("只读");
    wrapper.unmount();
    delete (window as { zen?: unknown }).zen;
  });
});
