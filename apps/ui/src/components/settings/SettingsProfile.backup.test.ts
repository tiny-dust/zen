import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SettingsProfile from "@/components/settings/SettingsProfile.vue";

type BackupApi = {
  exportFile: ReturnType<typeof vi.fn>;
  previewImport: ReturnType<typeof vi.fn>;
  applyImport: ReturnType<typeof vi.fn>;
};

let pinia: ReturnType<typeof createPinia>;
let sync: BackupApi;

function button(wrapper: ReturnType<typeof mount>, text: string) {
  const found = wrapper.findAll("button").find((item) => item.text().trim() === text);
  expect(found, `Missing button: ${text}`).toBeTruthy();
  return found!;
}

function password(wrapper: ReturnType<typeof mount>) {
  return wrapper.find('input[type="password"]');
}

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  sync = {
    exportFile: vi.fn().mockResolvedValue({ ok: true }),
    previewImport: vi.fn().mockResolvedValue({ ok: true, preview: { sections: [] } }),
    applyImport: vi.fn().mockResolvedValue({ ok: true }),
  };
  vi.stubGlobal("zen", {
    sync,
    lark: { onLoginEvent: vi.fn().mockReturnValue(() => undefined) },
  });
});

afterEach(() => {
  document.body.innerHTML = "";
  disposePinia(pinia);
  vi.unstubAllGlobals();
});

describe("SettingsProfile local backup", () => {
  it("works while signed out, requires password, and clears password on canceled export", async () => {
    sync.exportFile.mockResolvedValueOnce({ ok: false, canceled: true });
    const wrapper = mount(SettingsProfile, { global: { plugins: [pinia] }, attachTo: document.body });
    expect(wrapper.text()).toContain("本地配置备份");
    expect(button(wrapper, "导出文件").attributes("disabled")).toBeDefined();

    await password(wrapper).setValue("temporary-secret");
    await button(wrapper, "导出文件").trigger("click");
    await flushPromises();
    expect(sync.exportFile).toHaveBeenCalledWith("temporary-secret");
    expect((password(wrapper).element as HTMLInputElement).value).toBe("");
    expect(wrapper.text()).not.toContain("配置文件已导出");
    expect(wrapper.text()).not.toContain("temporary-secret");
    wrapper.unmount();
  });

  it("previews categories without selecting any, applies only selected ids after confirmation", async () => {
    sync.previewImport.mockResolvedValueOnce({
      ok: true,
      preview: { sections: [
        { id: "models", label: "模型供应", count: 2 },
        { id: "settings", label: "Agent 设置", count: 3 },
      ] },
    });
    const wrapper = mount(SettingsProfile, { global: { plugins: [pinia] }, attachTo: document.body });
    await password(wrapper).setValue("preview-pass");
    await button(wrapper, "选择文件并预览").trigger("click");
    await flushPromises();
    expect(sync.previewImport).toHaveBeenCalledWith("preview-pass");
    expect((password(wrapper).element as HTMLInputElement).value).toBe("");
    expect(wrapper.text()).toContain("模型供应");
    expect(wrapper.text()).toContain("2 项");
    expect(button(wrapper, "覆盖所选分类").attributes("disabled")).toBeDefined();

    await wrapper.find('button[aria-label="模型供应"]').trigger("click");
    await button(wrapper, "覆盖所选分类").trigger("click");
    await flushPromises();
    expect(sync.applyImport).not.toHaveBeenCalled();
    const confirm = [...document.body.querySelectorAll("button")].find((el) => el.textContent?.trim() === "覆盖所选分类" && el.closest('[role="dialog"]'));
    expect(confirm).toBeTruthy();
    confirm!.click();
    await flushPromises();
    expect(sync.applyImport).toHaveBeenCalledWith(["models"]);
    expect(() => structuredClone(sync.applyImport.mock.calls[0]![0])).not.toThrow();
    expect(wrapper.text()).toContain("已覆盖所选配置");
    wrapper.unmount();
  });

  it("keeps preview on apply failure so users can retry", async () => {
    sync.previewImport.mockResolvedValueOnce({ ok: true, preview: { sections: [{ id: "models", label: "模型供应", count: 1 }] } });
    sync.applyImport.mockResolvedValueOnce({ ok: false, error: "写入失败" });
    const wrapper = mount(SettingsProfile, { global: { plugins: [pinia] }, attachTo: document.body });
    await password(wrapper).setValue("pass");
    await button(wrapper, "选择文件并预览").trigger("click");
    await flushPromises();
    await wrapper.find('button[aria-label="模型供应"]').trigger("click");
    await button(wrapper, "覆盖所选分类").trigger("click");
    await flushPromises();
    [...document.body.querySelectorAll("button")].find((el) => el.textContent?.trim() === "覆盖所选分类" && el.closest('[role="dialog"]'))!.click();
    await flushPromises();
    expect(wrapper.text()).toContain("写入失败");
    expect(wrapper.text()).toContain("模型供应");
    wrapper.unmount();
  });
});
