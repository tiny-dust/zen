import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
  AvatarImage,
} from "@/components/ui/avatar";

describe("ui/avatar 冒烟", () => {
  it("Avatar + Image/Fallback/Badge 可挂载", async () => {
    const wrapper = mount(
      {
        components: { Avatar, AvatarImage, AvatarFallback, AvatarBadge },
        template: `
          <Avatar size="lg">
            <AvatarImage src="https://example.com/a.png" alt="头像" />
            <AvatarFallback>AB</AvatarFallback>
            <AvatarBadge />
          </Avatar>
        `,
      },
      { attachTo: document.body },
    );
    await Promise.resolve();

    expect(wrapper.find('[data-slot="avatar"]').exists()).toBe(true);
    expect(wrapper.find('[data-slot="avatar-fallback"]').text()).toBe("AB");
    expect(wrapper.find('[data-slot="avatar-badge"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it("AvatarGroup 与 AvatarGroupCount 可挂载", async () => {
    const wrapper = mount(
      {
        components: { AvatarGroup, AvatarGroupCount, Avatar, AvatarFallback },
        template: `
          <AvatarGroup>
            <Avatar><AvatarFallback>一</AvatarFallback></Avatar>
            <Avatar><AvatarFallback>二</AvatarFallback></Avatar>
            <AvatarGroupCount>+3</AvatarGroupCount>
          </AvatarGroup>
        `,
      },
      { attachTo: document.body },
    );
    await Promise.resolve();

    expect(wrapper.find('[data-slot="avatar-group"]').exists()).toBe(true);
    expect(wrapper.find('[data-slot="avatar-group-count"]').text()).toBe("+3");
    wrapper.unmount();
  });
});
