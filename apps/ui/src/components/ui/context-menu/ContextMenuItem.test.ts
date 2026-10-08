import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";

describe("ui/context-menu 冒烟", () => {
  it("ContextMenuItem 与 Separator 在菜单内容中可挂载", async () => {
    const wrapper = mount(
      {
        components: { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator },
        template: `
          <ContextMenu>
            <ContextMenuTrigger>触发区</ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem>打开</ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem variant="destructive">删除</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        `,
      },
      { attachTo: document.body },
    );
    await Promise.resolve();

    // 右键触发菜单展开（ContextMenu 走指针事件而非受控 open）
    await wrapper.get('[data-slot="context-menu-trigger"], [role="button"], div').trigger("contextmenu");
    await Promise.resolve();

    const text = document.body.textContent ?? "";
    expect(text).toContain("打开");
    expect(text).toContain("删除");
    wrapper.unmount();
  });
});
