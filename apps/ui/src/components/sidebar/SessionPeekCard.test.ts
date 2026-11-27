import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import SessionPeekCard from "@/components/sidebar/SessionPeekCard.vue";
import { i18n } from "@/locales";

import type { SessionRecord } from "@zen/shared";

const session: SessionRecord = {
  id: "s-1",
  title: "会话一",
  workspaceId: "ws-1",
  draft: "",
  pinned: false,
  archived: false,
  createdAt: Date.now() - 120_000,
  updatedAt: Date.now() - 120_000,
};

function mountCard(props: { editing?: boolean } = {}) {
  return mount(SessionPeekCard, {
    props: {
      session,
      top: 100,
      left: 320,
      status: "进行中",
      place: "项目一",
      editing: props.editing ?? false,
    },
    global: { plugins: [i18n], stubs: { teleport: true } },
    attachTo: document.body,
  });
}

describe("SessionPeekCard 悬停详情卡", () => {
  it("展示状态、工作区与相对时间", () => {
    const wrapper = mountCard();

    expect(wrapper.text()).toContain("会话一");
    expect(wrapper.text()).toContain("进行中");
    expect(wrapper.text()).toContain("项目一");
    expect(wrapper.text()).toContain("2 分钟前");
    wrapper.unmount();
  });

  it("点标题进入改名，Enter 提交新标题", async () => {
    const wrapper = mountCard();

    await wrapper.find("button").trigger("click");
    expect(wrapper.emitted("update:editing")?.[0]).toEqual([true]);

    await wrapper.setProps({ editing: true });
    const input = wrapper.find("input");
    await input.setValue("新标题");
    await input.trigger("keydown", { key: "Enter" });

    expect(wrapper.emitted("rename")?.[0]).toEqual(["新标题"]);
    expect(wrapper.emitted("update:editing")?.at(-1)).toEqual([false]);
    wrapper.unmount();
  });

  it("Escape 放弃改名，不发 rename", async () => {
    const wrapper = mountCard({ editing: true });

    const input = wrapper.find("input");
    await input.setValue("改了一半");
    await input.trigger("keydown", { key: "Escape" });

    expect(wrapper.emitted("rename")).toBeUndefined();
    expect(wrapper.emitted("update:editing")?.at(-1)).toEqual([false]);
    wrapper.unmount();
  });
});
