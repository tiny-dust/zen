import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import Select from "@/components/ui/select/Select.vue";
import SelectContent from "@/components/ui/select/SelectContent.vue";
import SelectGroup from "@/components/ui/select/SelectGroup.vue";
import SelectItem from "@/components/ui/select/SelectItem.vue";
import SelectItemText from "@/components/ui/select/SelectItemText.vue";
import SelectLabel from "@/components/ui/select/SelectLabel.vue";
import SelectScrollDownButton from "@/components/ui/select/SelectScrollDownButton.vue";
import SelectScrollUpButton from "@/components/ui/select/SelectScrollUpButton.vue";
import SelectSeparator from "@/components/ui/select/SelectSeparator.vue";
import SelectTrigger from "@/components/ui/select/SelectTrigger.vue";
import SelectValue from "@/components/ui/select/SelectValue.vue";

describe("ui/select 冒烟", () => {
  it("SelectItemText/Label/Separator/ScrollUp/DownButton 在 SelectContent 中可挂载", async () => {
    const wrapper = mount(
      {
        components: {
          Select,
          SelectTrigger,
          SelectValue,
          SelectContent,
          SelectGroup,
          SelectLabel,
          SelectItem,
          SelectItemText,
          SelectSeparator,
          SelectScrollUpButton,
          SelectScrollDownButton,
        },
        data: () => ({ value: "a" }),
        template: `
          <Select v-model="value" :open="true">
            <SelectTrigger><SelectValue placeholder="选择" /></SelectTrigger>
            <SelectContent>
              <SelectScrollUpButton />
              <SelectGroup>
                <SelectLabel>分组</SelectLabel>
                <SelectItem value="a"><SelectItemText>选项 A</SelectItemText></SelectItem>
                <SelectSeparator />
                <SelectItem value="b"><SelectItemText>选项 B</SelectItemText></SelectItem>
              </SelectGroup>
              <SelectScrollDownButton />
            </SelectContent>
          </Select>
        `,
      },
      { attachTo: document.body },
    );
    await Promise.resolve();

    const text = document.body.textContent ?? "";
    expect(text).toContain("分组");
    expect(text).toContain("选项 A");
    expect(document.body.querySelector('[data-slot="select-label"]')).toBeTruthy();
    expect(document.body.querySelector('[data-slot="select-separator"]')).toBeTruthy();
    wrapper.unmount();
  });
});
