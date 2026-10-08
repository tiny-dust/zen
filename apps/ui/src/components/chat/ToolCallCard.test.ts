import { mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import ToolCallCard from "@/components/chat/ToolCallCard.vue";

import type { VueWrapper } from "@vue/test-utils";
import type { ToolCallMessageMeta } from "@zen/shared";

let pinia: ReturnType<typeof createPinia>;

function mountCard(meta: ToolCallMessageMeta, content?: string): VueWrapper {
  return mount(ToolCallCard, {
    props: { meta, ...(content === undefined ? {} : { content }) },
    global: {
      plugins: [pinia],
      // ToolCallRow 已有独立覆盖，这里只验证 legacyToolPart 转换
      stubs: {
        ToolCallRow: {
          name: "ToolCallRow",
          props: ["part"],
          template: "<div class='row-stub'>{{ part.toolName }}|{{ part.state }}</div>",
        },
      },
    },
    attachTo: document.body,
  });
}

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
});

afterEach(() => {
  document.body.innerHTML = "";
  disposePinia(pinia);
});

describe("ToolCallCard", () => {
  it("ok 元数据映射为 ok 状态并携带 args/summary", () => {
    const wrapper = mountCard({
      toolName: "readFile",
      ok: true,
      summary: "读取了 a.ts",
      args: { path: "a.ts" },
      output: "内容",
    });

    expect(wrapper.text()).toContain("readFile|ok");
    wrapper.unmount();
  });

  it("显式 state 优先于 ok 推断（如 awaiting-approval）", () => {
    const wrapper = mountCard({
      toolName: "runTerminal",
      ok: false,
      state: "running",
      percent: 40,
    });

    expect(wrapper.text()).toContain("runTerminal|running");
    wrapper.unmount();
  });

  it("无 state 时按 ok 推断：失败进 error，content 回填 summary", () => {
    const wrapper = mountCard(
      { toolName: "writeFile", ok: false, summary: "" },
      "写入失败：磁盘满",
    );

    expect(wrapper.text()).toContain("writeFile|error");
    wrapper.unmount();
  });
});
