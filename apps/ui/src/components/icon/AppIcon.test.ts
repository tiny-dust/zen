import { mount } from "@vue/test-utils";
import { IconChevronDown } from "@tabler/icons-vue";
import { describe, expect, it } from "vitest";

import AppIcon from "./AppIcon.vue";

describe("AppIcon", () => {
  it("三档尺寸与统一线宽", () => {
    const nav = mount(AppIcon, { props: { icon: IconChevronDown, size: "nav" } });
    expect(nav.find("svg").attributes("width")).toBe("18");
    expect(nav.find("svg").attributes("stroke-width")).toBe("1.75");

    const empty = mount(AppIcon, { props: { icon: IconChevronDown, size: "empty" } });
    expect(empty.find("svg").attributes("width")).toBe("22");
  });

  it("默认装饰性隐藏；给 label 时作为图片朗读", () => {
    const plain = mount(AppIcon, { props: { icon: IconChevronDown } });
    expect(plain.find("svg").attributes("aria-hidden")).toBe("true");
    expect(plain.find("svg").attributes("aria-label")).toBeUndefined();

    const labeled = mount(AppIcon, { props: { icon: IconChevronDown, label: "展开" } });
    expect(labeled.find("svg").attributes("aria-label")).toBe("展开");
    expect(labeled.find("svg").attributes("aria-hidden")).toBeUndefined();
  });
});
