import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import ExportSessionDialog from "@/components/session/ExportSessionDialog.vue";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

function mountDialog(exportSession: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("zen", { session: { exportSession } });
  return mount(ExportSessionDialog, {
    props: { open: true, sessionId: "s1", sessionTitle: "登录重构" },
    // reka 的 Dialog 依赖 portal / focus trap，测试里用最小桩就地渲染
    global: {
      stubs: {
        Dialog: { props: ["open"], template: '<div v-if="open"><slot /></div>' },
        DialogContent: { template: "<div><slot /></div>" },
        DialogTitle: { template: "<div><slot /></div>" },
        DialogDescription: { template: "<div><slot /></div>" },
        teleport: true,
      },
    },
  });
}

describe("ExportSessionDialog", () => {
  it("默认 Markdown、不导出思考；勾选后按所选格式带 options", async () => {
    const exportSession = vi.fn().mockResolvedValue({ ok: true, path: "/tmp/a.md" });
    const wrapper = mountDialog(exportSession);
    await flushPromises();

    // 切到 HTML
    const htmlButton = wrapper.findAll("button").find((item) => item.text().includes("HTML"));
    expect(htmlButton).toBeTruthy();
    await htmlButton!.trigger("click");

    // 勾选「包含思考内容」
    await wrapper.find('[role="checkbox"]').trigger("click");
    await flushPromises();

    const confirm = wrapper.findAll("button").find((item) => item.text().trim() === "导出");
    expect(confirm).toBeTruthy();
    await confirm!.trigger("click");
    await flushPromises();

    expect(exportSession).toHaveBeenCalledWith("s1", "html", { includeReasoning: true });
    expect(wrapper.emitted("update:open")?.[0]).toEqual([false]);
    wrapper.unmount();
  });

  it("导出失败时在弹窗内提示，不关闭", async () => {
    const exportSession = vi.fn().mockResolvedValue({ ok: false, error: "磁盘已满" });
    const wrapper = mountDialog(exportSession);
    await flushPromises();

    const confirm = wrapper.findAll("button").find((item) => item.text().trim() === "导出");
    await confirm!.trigger("click");
    await flushPromises();

    expect(wrapper.find('[role="alert"]').text()).toContain("磁盘已满");
    expect(wrapper.emitted("update:open")).toBeUndefined();
    expect(exportSession).toHaveBeenCalledWith("s1", "md", { includeReasoning: false });
    wrapper.unmount();
  });
});
