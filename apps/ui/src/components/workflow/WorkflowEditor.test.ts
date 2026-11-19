import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";

import WorkflowEditor from "./WorkflowEditor.vue";
import type { WorkflowGraph } from "./graph";

function node(id: string, type: WorkflowGraph["nodes"][number]["type"], x = 0) {
  return { id, type, label: type, x, y: 0, settings: {} };
}

describe("WorkflowEditor", () => {
  it("edits run budgets as controlled graph data and shows validation feedback", async () => {
    const wrapper = mount(WorkflowEditor, { props: { modelValue: { nodes: [], edges: [] } } });
    expect(wrapper.find('[role="alert"]').text()).toContain("运行预算无效");
    await wrapper.find("#workflow-steps").setValue("25");
    const next = wrapper.emitted("update:modelValue")?.[0]?.[0] as WorkflowGraph;
    expect(next.budgets).toEqual({ maxSteps: 25, maxEffects: 10 });
  });

  it("adds a node from the palette and selects it", async () => {
    const wrapper = mount(WorkflowEditor, { props: { modelValue: { nodes: [], edges: [] } } });
    await wrapper.find('[data-palette="model"]').trigger("click");
    const next = wrapper.emitted("update:modelValue")?.[0]?.[0] as WorkflowGraph;
    expect(next.nodes).toMatchObject([{ type: "model", label: "model", settings: {} }]);
    expect(next.edges).toEqual([]);
    expect(JSON.parse(JSON.stringify(next))).toEqual(next);
    expect(wrapper.emitted("selectionChange")?.[0]?.[0]).toBe(next.nodes[0]?.id);
  });

  it("switches the configuration panel to the selected node type", async () => {
    const wrapper = mount(WorkflowEditor, {
      props: {
        modelValue: {
          nodes: [node("condition", "condition"), node("answer", "model", 200)],
          edges: [],
          budgets: { maxSteps: 10, maxEffects: 2 },
        },
      },
    });
    await wrapper.find('button[aria-label="查看「条件」（条件节点）"]').trigger("click");
    expect(wrapper.find("#workflow-left").exists()).toBe(true);
    expect(wrapper.find("#workflow-right").exists()).toBe(true);
    expect(wrapper.find("#workflow-operator").exists()).toBe(true);
    expect(wrapper.find("#workflow-model").exists()).toBe(false);

    await wrapper.find('button[aria-label="查看「模型」（模型节点）"]').trigger("click");
    expect(wrapper.find("#workflow-model").exists()).toBe(true);
    expect(wrapper.find("#workflow-instructions").exists()).toBe(true);
    expect(wrapper.find("#workflow-left").exists()).toBe(false);
  });

  it("marks nodes that cannot run and shows the outgoing outlets per type", () => {
    const wrapper = mount(WorkflowEditor, {
      props: {
        modelValue: {
          nodes: [node("tool", "tool"), node("review", "approval", 200), node("loop", "loop", 400)],
          edges: [],
          budgets: { maxSteps: 10, maxEffects: 2 },
        },
      },
    });
    expect(wrapper.text()).toContain("不支持");
    expect(wrapper.find('[data-outlet="review:approved"]').exists()).toBe(true);
    expect(wrapper.find('[data-outlet="review:denied"]').exists()).toBe(true);
    expect(wrapper.find('[data-outlet="loop:body"]').exists()).toBe(true);
    expect(wrapper.find('[data-outlet="loop:exit"]').exists()).toBe(true);
    expect(wrapper.find('[data-outlet="tool:next"]').exists()).toBe(true);
  });

  it("lists existing connections and removes the selected one", async () => {
    const graph: WorkflowGraph = {
      nodes: [node("start", "start"), node("end", "end", 200)],
      edges: [{ id: "edge-1", source: "start", target: "end", type: "next" }],
      budgets: { maxSteps: 10, maxEffects: 2 },
    };
    const wrapper = mount(WorkflowEditor, { props: { modelValue: graph } });
    await wrapper.find('button[aria-label="选择连线 开始 → 结束"]').trigger("click");
    expect(wrapper.text()).toContain("连线配置");
    const remove = wrapper.findAll("button").find((button) => button.text().includes("删除连线"));
    expect(remove).toBeDefined();
    await remove!.trigger("click");
    const next = wrapper.emitted("update:modelValue")?.[0]?.[0] as WorkflowGraph;
    expect(next.edges).toEqual([]);
    expect(graph.edges).toHaveLength(1);
  });
});
