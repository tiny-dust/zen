import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogScrollContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

describe("ui/dialog 冒烟", () => {
  it("Dialog + DialogContent/Header/Footer/Title/Description/Close/Trigger 可挂载", async () => {
    const wrapper = mount(
      {
        components: {
          Dialog,
          DialogContent,
          DialogHeader,
          DialogFooter,
          DialogTitle,
          DialogDescription,
          DialogClose,
          DialogTrigger,
        },
        template: `
          <Dialog :open="true">
            <DialogTrigger>打开</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>标题</DialogTitle>
                <DialogDescription>描述</DialogDescription>
              </DialogHeader>
              <p>正文</p>
              <DialogFooter>
                <DialogClose>关闭</DialogClose>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        `,
      },
      { attachTo: document.body },
    );
    await Promise.resolve();

    expect(document.body.textContent).toContain("标题");
    expect(document.body.textContent).toContain("描述");
    expect(document.body.querySelector('[data-slot="dialog-header"]')).toBeTruthy();
    expect(document.body.querySelector('[data-slot="dialog-footer"]')).toBeTruthy();
    expect(document.body.querySelector('[data-slot="dialog-close"]')).toBeTruthy();
    wrapper.unmount();
  });

  it("DialogOverlay 与 DialogScrollContent 可挂载", async () => {
    const wrapper = mount(
      {
        components: { Dialog, DialogOverlay, DialogScrollContent, DialogTitle },
        template: `
          <Dialog :open="true">
            <DialogScrollContent>
              <DialogTitle>滚动标题</DialogTitle>
              <DialogOverlay class="test-overlay" />
              <p>长内容</p>
            </DialogScrollContent>
          </Dialog>
        `,
      },
      { attachTo: document.body },
    );
    await Promise.resolve();

    // DialogScrollContent 自带一层 overlay；额外挂载的 DialogOverlay 也在文档内
    expect(document.body.querySelectorAll('[data-slot="dialog-overlay"]').length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("滚动标题");
    // DialogScrollContent 内置关闭控件（sr-only 文案）
    expect(document.body.textContent).toContain("Close");
    wrapper.unmount();
  });
});
