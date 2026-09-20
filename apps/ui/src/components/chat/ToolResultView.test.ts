import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import ToolResultView from "./ToolResultView.vue";


describe("ToolResultView", () => {
  it("renders complete readable code with real line numbers and preserved indentation", () => {
    const code = `const first = 1;\n\n  ${"x".repeat(4200)}\nconst last = true;\n`;
    const wrapper = mount(ToolResultView, { props: { result: { kind: "code", text: code } } });
    expect(wrapper.findAll(".tool-line-number").map((node) => node.text())).toEqual(["1", "2", "3", "4"]);
    expect(wrapper.findAll("pre")[2]?.element.textContent).toBe(`  ${"x".repeat(4200)}`);
    expect(wrapper.text()).toContain("const last = true;");
    wrapper.unmount();
  });

  it("keeps both sides of an unterminated edit colored and numbered", () => {
    const wrapper = mount(ToolResultView, { props: { result: { kind: "diff", before: "a\nb\nc", after: "a\nB\nC" } } });
    const figure = wrapper.get('[aria-label="文件 diff"]');
    const rows = figure.element.children;
    expect(figure.text()).toContain("C");
    const added = [...rows].filter((row) => row.className.includes("--color-add"));
    const deleted = [...rows].filter((row) => row.className.includes("--color-del"));
    expect(added).toHaveLength(2);
    expect(deleted).toHaveLength(2);
    expect(added[1]?.textContent).toBe("3+C");
    expect(deleted[1]?.textContent).toBe("3-c");
    expect(wrapper.get(".tool-result-footer").text()).toBe("+2-2");
    wrapper.unmount();
  });

  it("renders output as text instead of interpreting terminal or code markup", () => {
    const text = '<script>alert("test")</script>\n<img src=x onerror=alert(1)>';
    const wrapper = mount(ToolResultView, { props: { result: { kind: "terminal", text, exitCode: 1 } } });
    expect(wrapper.get("pre").element.textContent).toBe(text);
    expect(wrapper.find("script,img").exists()).toBe(false);
    expect(wrapper.text()).toContain("退出码 1");
    wrapper.unmount();
  });

  it("renders empty files and no-change results without misleading additions", () => {
    const empty = mount(ToolResultView, { props: { result: { kind: "code", text: "" } } });
    expect(empty.text()).toBe("空文件");
    empty.unmount();
    const unchanged = mount(ToolResultView, { props: { result: { kind: "diff", before: "same", after: "same" } } });
    expect(unchanged.text()).toBe("文件内容未变化");
    unchanged.unmount();
  });
});
