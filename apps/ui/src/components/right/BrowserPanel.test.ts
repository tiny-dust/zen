import { shallowMount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import BrowserPanel from "@/components/right/BrowserPanel.vue";
import { useBrowserStore } from "@/stores/browser";

describe("BrowserPanel", () => {
  it("有最近标注时不显示底部卡片，仍保留标注入口", () => {
    const browser = useBrowserStore();
    browser.lastPicked = {
      selector: "#submit",
      selectorCandidates: [],
      tag: "button",
      id: "submit",
      className: "",
      text: "提交",
      name: "",
      type: "",
      placeholder: "",
      ariaLabel: "",
      role: "",
      href: "",
      rect: { x: 0, y: 0, width: 80, height: 30 },
      pageUrl: "https://example.com",
      pageTitle: "Example",
    };

    const wrapper = shallowMount(BrowserPanel, {
      global: { stubs: { Button: false, Primitive: false } },
    });

    expect(browser.lastPicked?.selector).toBe("#submit");
    expect(wrapper.text()).not.toContain("最近标注");
    expect(wrapper.html()).not.toContain("#submit");
    expect(wrapper.find('[aria-label="标注"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
