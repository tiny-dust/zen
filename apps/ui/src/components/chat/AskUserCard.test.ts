// askUser 提问卡：优先级徽标 / 多问询暂存 + 自动跳下一题 / 统一提交 / 单问询即时回答。
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AskUserCard from "@/components/chat/AskUserCard.vue";
import { useChatStore } from "@/stores/chat";

import type { AskUserQuestionEvent } from "@zen/shared";

const resolveAsk = vi.fn().mockResolvedValue({ ok: true });

function askOf(
  askId: string,
  question: string,
  priority: "high" | "medium" | "low",
): AskUserQuestionEvent {
  return {
    askId,
    toolCallId: `tc-${askId}`,
    question,
    priority,
    options: ["选项 A", "选项 B"],
    allowFreeText: true,
  };
}

function store() {
  return useChatStore();
}

beforeEach(() => {
  resolveAsk.mockClear();
  vi.stubGlobal("zen", { agent: { resolveAsk } });
  const chat = store();
  chat.pendingAsks = [];
  chat.askAnswers = {};
});

describe("AskUserCard", () => {
  it("展示模型给出的推荐优先级徽标", () => {
    const chat = store();
    chat.pendingAsks = [askOf("a1", "先做哪个？", "high")];
    const wrapper = mount(AskUserCard);
    expect(wrapper.text()).toContain("高");
    expect(wrapper.text()).toContain("先做哪个？");
  });

  it("多问询：答一题只暂存并跳到下一题，全部答完才能统一提交", async () => {
    const chat = store();
    chat.pendingAsks = [askOf("a1", "第一问", "high"), askOf("a2", "第二问", "low")];
    const wrapper = mount(AskUserCard);

    // 第一题选 A：只暂存，不写回主进程
    await wrapper.findAll('[role="option"]')[0]!.trigger("click");
    await flushPromises();
    expect(resolveAsk).not.toHaveBeenCalled();
    expect(chat.askAnswers).toEqual({ a1: "选项 A" });
    // 自动切到第二题
    expect(wrapper.text()).toContain("第二问");
    expect(wrapper.text()).toContain("1/2 已答");
    // 返回上一题可见暂存答案（可重选覆盖）
    await wrapper.find('[aria-label="上一问"]').trigger("click");
    expect(wrapper.text()).toContain("已答：选项 A");
    await wrapper.find('[aria-label="下一问"]').trigger("click");

    // 只答了一题：提交按钮不可用
    const submitAll = () =>
      wrapper.findAll("button").find((item) => item.text().includes("提交全部回答"))!;
    expect(submitAll().attributes("disabled")).toBeDefined();

    // 答完第二题：按钮变为可提交，点击后逐题写回
    await wrapper.findAll('[role="option"]')[0]!.trigger("click");
    await flushPromises();
    expect(chat.askAnswers).toEqual({ a1: "选项 A", a2: "选项 A" });
    expect(submitAll().attributes("disabled")).toBeUndefined();
    await submitAll().trigger("click");
    await flushPromises();
    expect(resolveAsk).toHaveBeenCalledTimes(2);
    expect(resolveAsk).toHaveBeenNthCalledWith(1, expect.any(String), { askId: "a1", answer: "选项 A" });
    expect(resolveAsk).toHaveBeenNthCalledWith(2, expect.any(String), { askId: "a2", answer: "选项 A" });
  });

  it("单问询：点选项即回答，无统一提交栏", async () => {
    const chat = store();
    chat.pendingAsks = [askOf("a1", "只此一问", "medium")];
    const wrapper = mount(AskUserCard);
    expect(wrapper.text()).not.toContain("提交全部回答");

    await wrapper.findAll('[role="option"]')[1]!.trigger("click");
    await flushPromises();
    expect(resolveAsk).toHaveBeenCalledTimes(1);
    expect(resolveAsk).toHaveBeenCalledWith(expect.any(String), {
      askId: "a1",
      answer: "选项 B",
    });
    expect(chat.pendingAsks).toHaveLength(0);
  });
});
