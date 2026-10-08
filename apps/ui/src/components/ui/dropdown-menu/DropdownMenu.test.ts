import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

describe("ui/dropdown-menu 冒烟", () => {
  it("整套菜单件可挂载并展示内容", async () => {
    const wrapper = mount(
      {
        components: {
          DropdownMenu,
          DropdownMenuTrigger,
          DropdownMenuContent,
          DropdownMenuGroup,
          DropdownMenuItem,
          DropdownMenuLabel,
          DropdownMenuSeparator,
          DropdownMenuShortcut,
          DropdownMenuCheckboxItem,
          DropdownMenuRadioGroup,
          DropdownMenuRadioItem,
          DropdownMenuSub,
          DropdownMenuSubTrigger,
          DropdownMenuSubContent,
        },
        data: () => ({ checked: true, radio: "a" }),
        template: `
          <DropdownMenu :open="true">
            <DropdownMenuTrigger>菜单</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>分组标题</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem>条目<DropdownMenuShortcut>⌘K</DropdownMenuShortcut></DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem v-model:checked="checked">勾选项</DropdownMenuCheckboxItem>
              <DropdownMenuRadioGroup v-model="radio">
                <DropdownMenuRadioItem value="a">单选 A</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>子菜单</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  <DropdownMenuItem>子条目</DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        `,
      },
      { attachTo: document.body },
    );
    await Promise.resolve();

    const text = document.body.textContent ?? "";
    expect(text).toContain("分组标题");
    expect(text).toContain("条目");
    expect(text).toContain("勾选项");
    expect(text).toContain("单选 A");
    expect(text).toContain("子菜单");
    wrapper.unmount();
  });
});
