import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import DiffView from "./DiffView.vue";

const diff = [
  "diff --git a/src/example.txt b/src/example.txt",
  "@@ -8,2 +8,2 @@",
  "-before",
  "+after",
  " unchanged",
].join("\n");

describe("DiffView 行内审阅", () => {
  it("把新增行的意见连同文件和新行号交给父组件", async () => {
    const wrapper = mount(DiffView, { props: { diff, path: "src/example.txt", commentable: true } });

    await wrapper.findAll('[aria-label="评论第 8 行"]')[1].trigger("click");
    await wrapper.get('textarea[aria-label="代码审阅意见"]').setValue("保留旧行为");
    const sendButton = wrapper.findAll("button").find((button) => button.text().includes("加入输入框"));
    expect(sendButton?.attributes("disabled")).toBeUndefined();
    await sendButton?.trigger("click");

    expect(wrapper.emitted("comment")?.[0]).toEqual([
      { path: "src/example.txt", line: 8, side: "new", text: "保留旧行为" },
    ]);
  });

  it("只读 diff 不显示审阅入口", () => {
    const wrapper = mount(DiffView, { props: { diff, path: "src/example.txt" } });
    expect(wrapper.find('[aria-label="评论第 8 行"]').exists()).toBe(false);
  });
});
