import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import WorkflowEditor from "./WorkflowEditor.vue";
import type { WorkflowGraph } from "./graph";

describe("WorkflowEditor", () => {
  it("edits run budgets as controlled graph data and shows validation feedback", async () => {
    const wrapper = mount(WorkflowEditor, { props: { modelValue: { nodes: [], edges: [] } } });
    expect(wrapper.find('[role="alert"]').text()).toContain("运行预算无效");
    await wrapper.find('#workflow-steps').setValue('25');
    const next = wrapper.emitted('update:modelValue')?.[0]?.[0] as WorkflowGraph;
    expect(next.budgets).toEqual({ maxSteps: 25, maxEffects: 10 });
  });

  it("shows unsupported node status and typed condition controls", async () => {
    const graph: WorkflowGraph = {
      budgets: { maxSteps: 10, maxEffects: 2 },
      nodes: [
        { id: "start", type: "start", label: "start", x: 0, y: 0, settings: {} },
        { id: "condition", type: "condition", label: "condition", x: 200, y: 0, settings: { left: "a", right: "b", operator: "equals" } },
        { id: "tool", type: "tool", label: "tool", x: 400, y: 0, settings: {} },
        { id: "end", type: "end", label: "end", x: 600, y: 0, settings: {} },
      ],
      edges: [],
    };
    const wrapper = mount(WorkflowEditor, { props: { modelValue: graph } });
    expect(wrapper.text()).toContain("不支持");
    await wrapper.find('button[aria-label="查看「条件」（条件节点）"]').trigger("click");
    expect(wrapper.find("#workflow-left").exists()).toBe(true);
    expect(wrapper.find("#workflow-right").exists()).toBe(true);
    expect(wrapper.find("#workflow-operator").exists()).toBe(true);
    expect(wrapper.find("#workflow-expression").exists()).toBe(false);
  });

  it("emits a new JSON graph and selection when adding a node", async () => {
    const graph: WorkflowGraph = { nodes: [], edges: [] };
    const wrapper = mount(WorkflowEditor, { props: { modelValue: graph } });
    const addButton = wrapper.findAll("button").find((button) => button.text().includes("添加节点"));
    expect(addButton).toBeDefined();
    await addButton!.trigger("click");
    const next = wrapper.emitted("update:modelValue")?.[0]?.[0] as WorkflowGraph;
    expect(next.nodes).toMatchObject([{ type: "model", label: "model", settings: {} }]);
    expect(next.edges).toEqual([]);
    expect(JSON.parse(JSON.stringify(next))).toEqual(next);
    expect(wrapper.emitted("selectionChange")?.[0]?.[0]).toBe(next.nodes[0]?.id);
    expect(graph.nodes).toEqual([]);
  });
});
