import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import FileLabel from "./FileLabel.vue";

afterEach(() => {
  document.body.innerHTML = "";
  delete (window as { zen?: unknown }).zen;
});

describe("FileLabel", () => {
  it("is presentational, keeps the complete tooltip, and shows only basename", () => {
    const path = "C:\\workspace\\src\\main.ts:12:3";
    const wrapper = mount(FileLabel, { props: { path } });
    expect(wrapper.element.tagName).toBe("SPAN");
    expect(wrapper.text()).toBe("main.ts");
    expect(wrapper.attributes("title")).toBe(path);
    expect(wrapper.find("button, a").exists()).toBe(false);
    expect(wrapper.get("img").attributes("aria-hidden")).toBe("true");
    expect(wrapper.get("img").attributes("alt")).toBe("");
    expect(wrapper.get("img").attributes("draggable")).toBe("false");
    wrapper.unmount();
  });

  it("keeps the same official SVG for link and normal variants", async () => {
    const wrapper = mount(FileLabel, { props: { path: "src/main.ts" } });
    const source = wrapper.get("img").attributes("src");
    await wrapper.setProps({ variant: "link" });
    expect(wrapper.classes()).toContain("file-label--link");
    expect(wrapper.get("img").attributes("src")).toBe(source);
    expect(wrapper.get("img").attributes("data-file-icon")).toBe("typescript");
    wrapper.unmount();
  });

  it("preserves long original attachment names without changing the tooltip", () => {
    const name = `${"long-name-".repeat(80)}.vue`;
    const wrapper = mount(FileLabel, { props: { path: "/tmp/upload-id", name } });
    expect(wrapper.get(".file-label__name").text()).toBe(name);
    expect(wrapper.attributes("title")).toBe("/tmp/upload-id");
    expect(wrapper.get("img").attributes("data-file-icon")).toBe("vue");
    wrapper.unmount();
  });

  it("keeps directory-scoped associations when name only repeats the basename", () => {
    const wrapper = mount(FileLabel, { props: { path: ".vscode/settings.json", name: "settings.json" } });
    expect(wrapper.text()).toBe("settings.json");
    expect(wrapper.get("img").attributes("data-file-icon")).toBe("vscode");
    wrapper.unmount();
  });

  it("updates unknown directory icons on expansion", async () => {
    const wrapper = mount(FileLabel, { props: { path: "parent/custom/", kind: "directory" } });
    const closed = wrapper.get("img").attributes("src");
    await wrapper.setProps({ expanded: true });
    expect(wrapper.text()).toBe("custom");
    expect(wrapper.get("img").attributes("src")).not.toBe(closed);
    expect(wrapper.get("img").attributes("data-file-icon")).toBe("_folder_open");
    wrapper.unmount();
  });

  it("opens the file context menu on right-click only for the link variant", async () => {
    (window as { zen?: unknown }).zen = {
      shell: {
        openPath: vi.fn(),
        showInFolder: vi.fn(),
        platformInfo: vi.fn().mockResolvedValue({
          platform: "darwin",
          showInFolderLabel: "在 Finder 中显示",
          openFolderLabel: "打开文件夹",
        }),
      },
    };
    const plain = mount(FileLabel, { props: { path: "src/a.ts" }, attachTo: document.body });
    await plain.trigger("contextmenu");
    expect(document.body.querySelector(".file-context-menu")).toBeNull();
    plain.unmount();

    const wrapper = mount(FileLabel, {
      props: { path: "src/a.ts", variant: "link" },
      attachTo: document.body,
    });
    await wrapper.trigger("contextmenu", { clientX: 12, clientY: 34 });
    await flushPromises();
    const menu = document.body.querySelector(".file-context-menu");
    expect(menu).not.toBeNull();
    expect([...menu!.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim()))
      .toEqual(["打开文件", "在 Finder 中显示"]);
    wrapper.unmount();
  });
});
