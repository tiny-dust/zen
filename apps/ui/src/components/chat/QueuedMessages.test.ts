import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import QueuedMessages from "@/components/chat/QueuedMessages.vue";

const items = [{ id: "queued-1", text: "重要待发送内容", createdAt: 1, attachments: [] }];

function mountQueue() {
  return mount(QueuedMessages, {
    props: { items },
    global: {
      stubs: {
        ConfirmDialog: {
          props: ["open", "title", "description"],
          emits: ["confirm", "update:open"],
          template: '<div v-if="open"><button class="cancel" @click="$emit(\'update:open\', false)">取消</button><button class="confirm" @click="$emit(\'confirm\')">确认</button></div>',
        },
      },
    },
  });
}

describe("QueuedMessages 删除确认", () => {
  it("点删除不立即移除；取消后仍保留消息", async () => {
    const wrapper = mountQueue();
    await wrapper.find('button[aria-label="删除插入消息"]').trigger("click");
    expect(wrapper.emitted("remove")).toBeUndefined();
    await wrapper.find("button.cancel").trigger("click");
    expect(wrapper.find("button.confirm").exists()).toBe(false);
    expect(wrapper.emitted("remove")).toBeUndefined();
  });

  it("确认后只移除选中的仍存在的消息", async () => {
    const wrapper = mountQueue();
    await wrapper.find('button[aria-label="删除插入消息"]').trigger("click");
    await wrapper.find("button.confirm").trigger("click");
    expect(wrapper.emitted("remove")).toEqual([["queued-1"]]);
  });
});
