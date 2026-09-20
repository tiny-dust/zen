import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, it } from "vitest";

import ComposerEditor from "@/components/chat/ComposerEditor.vue";

const wrappers: ReturnType<typeof mount<typeof ComposerEditor>>[] = [];

const elementMark = {
  id: "be_1",
  label: "登录",
  token: "$el:登录",
  ref: {
    selector: "#login",
    selectorCandidates: ["#login"],
    tag: "button",
    id: "login",
    className: "btn",
    text: "登录",
    name: "",
    type: "submit",
    placeholder: "",
    ariaLabel: "登录按钮",
    role: "button",
    href: "",
    rect: { x: 10, y: 20, width: 80, height: 32 },
    pageUrl: "https://example.com/",
    pageTitle: "Example",
  },
};

function editor(source: string, attachments = false, elements: typeof elementMark[] = []) {
  const wrapper = mount(ComposerEditor, {
    attachTo: document.body,
    props: {
      modelValue: source,
      attachments: attachments ? [{ id: "file-1", name: "报告.ts", path: "/tmp/报告.ts", size: 1, isImage: false }] : [],
      elements,
    },
  });
  wrappers.push(wrapper);
  wrapper.get(".composer-editor").element.setAttribute("tabindex", "0");
  wrapper.vm.focus();
  return wrapper;
}

function select(start: Node, offset: number, end = start, endOffset = offset) {
  const range = document.createRange();
  range.setStart(start, offset);
  range.setEnd(end, endOffset);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
}

function beforeInput(element: Element, inputType: string, data: string | null = null) {
  const event = new InputEvent("beforeinput", { inputType, data, bubbles: true, cancelable: true });
  element.dispatchEvent(event);
  return event;
}

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  window.getSelection()?.removeAllRanges();
});

describe("ComposerEditor atomic tokens", () => {
  it("keeps exact source with hidden prefixes and shared file labels", () => {
    const source = "前 /skill:coder $报告.ts **bold** [link](https://example.com)";
    const wrapper = editor(source, true);
    expect(wrapper.get(".composer-editor").element.textContent).toBe(source);
    expect(wrapper.find(".composer-token-skill .composer-token-prefix").text()).toBe("/skill:");
    expect(wrapper.find(".composer-token-skill .lucide").exists()).toBe(true);
    expect(wrapper.find(".file-label--link").text()).toBe("报告.ts");
    expect(wrapper.findAll(".composer-token").every(token => token.attributes("contenteditable") === "false")).toBe(true);
  });

  it("restores all source offsets outside non-editable tokens", async () => {
    const wrapper = editor("/skill:coder $报告.ts", true);
    for (let offset = 0; offset <= (wrapper.get(".composer-editor").element.textContent?.length ?? 0); offset++) {
      wrapper.vm.setCaretSoon(offset);
      await nextTick();
      const anchor = window.getSelection()?.anchorNode;
      expect(anchor).toBeTruthy();
      expect(anchor?.parentElement?.closest(".composer-token")).toBeNull();
    }
  });

  it("inserts after a restored token boundary without changing its source", async () => {
    const wrapper = editor("/skill:coder");
    wrapper.vm.setCaretSoon(12);
    await nextTick();
    wrapper.vm.insertAtCaret(" 中文");
    expect(wrapper.get(".composer-editor").element.textContent).toBe("/skill:coder 中文");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["/skill:coder 中文"]);
  });

  it.each(["deleteContentBackward", "deleteContentForward"])("deletes the whole skill on %s", async inputType => {
    const wrapper = editor("/skill:coder");
    wrapper.vm.setCaretSoon(inputType === "deleteContentBackward" ? 12 : 0);
    await nextTick();
    expect(beforeInput(wrapper.get(".composer-editor").element, inputType).defaultPrevented).toBe(true);
    expect(wrapper.get(".composer-editor").element.textContent).toBe("");
  });

  it("expands partial token deletion to the whole token", () => {
    const wrapper = editor("/skill:coder end");
    const name = wrapper.find(".composer-token-name").element.firstChild;
    if (!name) throw new Error("Missing skill name");
    select(name, 1, name, 3);
    beforeInput(wrapper.get(".composer-editor").element, "deleteContentBackward");
    expect(wrapper.get(".composer-editor").element.textContent).toBe(" end");
  });

  it("deletes from an interior caret without consuming adjacent text", () => {
    const wrapper = editor("前 /skill:coder 后");
    const name = wrapper.find(".composer-token-name").element.firstChild;
    if (!name) throw new Error("Missing skill name");
    select(name, 1);
    beforeInput(wrapper.get(".composer-editor").element, "deleteContentBackward");
    expect(wrapper.get(".composer-editor").element.textContent).toBe("前  后");
  });

  it("replaces a selection with plain text on insertion and paragraph input", () => {
    const wrapper = editor("before /skill:coder after");
    select(wrapper.get(".composer-editor").element, 0, wrapper.get(".composer-editor").element, 2);
    wrapper.vm.insertAtCaret("替换");
    expect(wrapper.get(".composer-editor").element.textContent).toBe("替换 after");
    select(wrapper.get(".composer-editor").element, 0, wrapper.get(".composer-editor").element, wrapper.get(".composer-editor").element.childNodes.length);
    beforeInput(wrapper.get(".composer-editor").element, "insertParagraph");
    expect(wrapper.get(".composer-editor").element.textContent).toBe("\n");
  });

  it("keeps composition nodes stable and emits the committed Chinese text", async () => {
    const wrapper = editor("/skill:coder ");
    const token = wrapper.find(".composer-token").element;
    await wrapper.get(".composer-editor").trigger("compositionstart");
    const text = document.createTextNode("中文");
    wrapper.get(".composer-editor").element.append(text);
    select(text, 2);
    await wrapper.get(".composer-editor").trigger("input");
    await wrapper.setProps({ modelValue: "external" });
    expect(wrapper.find(".composer-token").element).toBe(token);
    expect(wrapper.get(".composer-editor").element.textContent).toBe("/skill:coder 中文");
    await wrapper.get(".composer-editor").trigger("compositionend");
    expect(wrapper.get(".composer-editor").element.textContent).toBe("/skill:coder 中文");
    expect(wrapper.emitted("update:modelValue")?.at(-1)).toEqual(["/skill:coder 中文"]);
  });

  it("cleans up mounted token views on rebuild and unmount", async () => {
    const wrapper = editor("/skill:coder $报告.ts", true);
    const icon = wrapper.find(".composer-token-icon").element;
    const label = wrapper.find(".composer-token-file .composer-token-name").element;
    await wrapper.setProps({ modelValue: "/skill:qa" });
    expect(icon.childNodes.length).toBe(0);
    expect(label.childNodes.length).toBe(0);
    const nextIcon = wrapper.find(".composer-token-icon").element;
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    expect(nextIcon.childNodes.length).toBe(0);
  });

  it("updates attachment decoration without changing source", async () => {
    const wrapper = editor("$报告.ts");
    expect(wrapper.find(".file-label").exists()).toBe(false);
    await wrapper.setProps({ attachments: [{ id: "file-1", name: "报告.ts", path: "/tmp/报告.ts", size: 1, isImage: false }] });
    expect(wrapper.find(".file-label").exists()).toBe(true);
    expect(wrapper.get(".composer-editor").element.textContent).toBe("$报告.ts");
  });

  it("does not insert when disabled", async () => {
    const wrapper = editor("/skill:coder");
    await wrapper.setProps({ disabled: true });
    wrapper.vm.insertAtCaret("bad");
    expect(wrapper.get(".composer-editor").element.textContent).toBe("/skill:coder");
  });

  it("renders browser element tokens as globe tags like skills", () => {
    const wrapper = editor("请点 $el:登录", false, [elementMark]);
    const token = wrapper.get(".composer-token-element");
    expect(token.find(".composer-token-prefix").text()).toBe("$el:");
    expect(token.find(".composer-token-name").text()).toBe("登录");
    expect(token.find(".lucide").exists()).toBe(true);
    expect(token.attributes("contenteditable")).toBe("false");
    expect(wrapper.get(".composer-editor").element.textContent).toBe("请点 $el:登录");
  });

  it("shows element detail tooltip on hover and hides on leave", async () => {
    const wrapper = editor("请点 $el:登录", false, [elementMark]);
    const token = wrapper.get(".composer-token-element");
    await token.trigger("mouseenter");
    await new Promise((resolve) => setTimeout(resolve, 150));
    const tip = document.querySelector(".composer-el-tooltip");
    expect(tip).toBeTruthy();
    expect(tip?.textContent).toContain("登录");
    expect(tip?.textContent).toContain("#login");
    expect(tip?.textContent).toContain("https://example.com/");
    await token.trigger("mouseleave");
    expect((tip as HTMLElement | null)?.style.display).toBe("none");
  });

  it("deletes the whole element token on backspace", async () => {
    const wrapper = editor("$el:登录", false, [elementMark]);
    wrapper.vm.setCaretSoon(6);
    await nextTick();
    beforeInput(wrapper.get(".composer-editor").element, "deleteContentBackward");
    expect(wrapper.get(".composer-editor").element.textContent).toBe("");
  });
});
