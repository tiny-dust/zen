import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { ref } from "vue";

import type { BrowserElementRef, SkillSummary } from "@zen/shared";

import { createComposerDomain } from "@/stores/chat-composer";
import { useAgentStore } from "@/stores/agent";

const browserRef: BrowserElementRef = {
  selector: "#login",
  selectorCandidates: ["#login"],
  tag: "button",
  id: "login",
  className: "btn",
  text: "登录",
  name: "",
  type: "submit",
  placeholder: "",
  ariaLabel: "",
  role: "button",
  href: "",
  rect: { x: 0, y: 0, width: 10, height: 10 },
  pageUrl: "https://example.com/",
  pageTitle: "Example",
};

function setup() {
  const input = ref("");
  const attachments = ref<never[]>([]);
  const domain = createComposerDomain({
    input,
    attachments: attachments as never,
  });
  return { input, attachments, domain };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("createComposerDomain 附件", () => {
  it("添加附件记录名称/路径/大小/图片标记", () => {
    const { attachments, domain } = setup();
    domain.addAttachment(new File(["x"], "a.png", { type: "image/png" }), "/u/a.png");
    domain.addAttachment(new File(["x"], "b.txt", { type: "text/plain" }), "/u/b.txt");
    expect(attachments.value.map((item: { name: string }) => item.name)).toEqual(["a.png", "b.txt"]);
    expect(attachments.value[0]).toMatchObject({ path: "/u/a.png", isImage: true });
    expect(attachments.value[1]).toMatchObject({ path: "/u/b.txt", isImage: false });
  });

  it("removeAttachment 按 id 删除", () => {
    const { attachments, domain } = setup();
    domain.addAttachment(new File(["x"], "a.png", { type: "image/png" }), "/u/a.png");
    domain.addAttachment(new File(["x"], "b.txt", { type: "text/plain" }), "/u/b.txt");
    const id = (attachments.value[0] as { id: string }).id;
    domain.removeAttachment(id);
    expect(attachments.value.map((item: { name: string }) => item.name)).toEqual(["b.txt"]);
  });

  it("registerAttachmentRef 按 path 去重登记历史上传文件", () => {
    const { attachments, domain } = setup();
    domain.registerAttachmentRef({ name: "报告.pdf", path: "/u/报告.pdf" });
    domain.registerAttachmentRef({ name: "报告.pdf", path: "/u/报告.pdf" });
    expect(attachments.value.map((item: { name: string }) => item.name)).toEqual(["报告.pdf"]);
    expect(attachments.value[0]).toMatchObject({ path: "/u/报告.pdf", size: 0, isImage: false });
  });

  it("registerAttachmentRef 按扩展名推断图片标记", () => {
    const { attachments, domain } = setup();
    domain.registerAttachmentRef({ name: "photo.png", path: "/u/photo.png" });
    expect(attachments.value[0]).toMatchObject({ isImage: true });
  });
});

describe("createComposerDomain 技能 token", () => {
  beforeEach(() => {
    const agent = useAgentStore();
    agent.skills = [
      {
        id: "/home/u/.claude/skills/coder",
        name: "coder",
        description: "编码技能",
        dir: "/home/u/.claude/skills/coder",
        source: "user",
        removable: true,
        disabled: false,
      },
    ] as SkillSummary[];
  });

  it("解析内联 /skill: token，已知技能带描述/目录", () => {
    const { domain } = setup();
    const found = domain.extractSkills("用 /skill:coder 处理，再看 /skill:missing 的效果");
    expect(found).toEqual([
      {
        name: "coder",
        description: "编码技能",
        dir: "/home/u/.claude/skills/coder",
        source: "user",
      },
      { name: "missing", description: "", dir: undefined, source: undefined },
    ]);
  });

  it("同名 token 去重，无 token 返回空", () => {
    const { domain } = setup();
    expect(domain.extractSkills("/skill:coder /skill:coder 完成")).toHaveLength(1);
    expect(domain.extractSkills("普通消息没有技能")).toEqual([]);
    expect(domain.extractSkills("/skill: 后面没有名称")).toEqual([]);
  });
});

describe("createComposerDomain 浏览器标注", () => {
  it("插入标注元素并把 token 写入待插入载荷", () => {
    const { domain } = setup();
    const mark = domain.insertBrowserElement(browserRef);
    expect(mark.token).toBe("$el:登录");
    expect(domain.elementMarks.value).toHaveLength(1);
    expect(domain.pendingComposerInsert.value?.text).toBe("$el:登录 ");
  });

  it("重复标签自动加序号区分", () => {
    const { domain } = setup();
    const a = domain.insertBrowserElement(browserRef);
    const b = domain.insertBrowserElement(browserRef);
    expect(a.token).toBe("$el:登录");
    expect(b.token).toBe("$el:登录2");
  });

  it("removeElementMark 移除标注并从正文剥掉 token", () => {
    const { input, domain } = setup();
    const mark = domain.insertBrowserElement(browserRef);
    input.value = `请点 ${mark.token} 这个按钮`;
    domain.removeElementMark(mark.id);
    expect(domain.elementMarks.value).toHaveLength(0);
    expect(input.value).toBe("请点 这个按钮");
    // 移除不存在的 id 不报错
    domain.removeElementMark("nope");
  });

  it("insertAtComposerCaret 空文本不产生载荷", () => {
    const { domain } = setup();
    domain.insertAtComposerCaret("");
    expect(domain.pendingComposerInsert.value).toBeNull();
    domain.insertAtComposerCaret("hello");
    expect(domain.pendingComposerInsert.value?.text).toBe("hello");
  });
});
