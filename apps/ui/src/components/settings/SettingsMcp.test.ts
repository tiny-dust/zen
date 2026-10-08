import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SettingsMcp from "@/components/settings/SettingsMcp.vue";

import type { DOMWrapper, VueWrapper } from "@vue/test-utils";
import type { McpDiscoveredServer, McpServerConfig, McpServerStatus } from "@zen/shared";

let pinia: ReturnType<typeof createPinia>;

/** 模拟一条从 Claude Desktop 扫描导入的服务（落库后与手动添加无差别） */
const importedConfig: McpServerConfig = {
  id: "srv-desk",
  name: "desk",
  transport: "stdio",
  command: "desk-cmd",
  args: [],
  env: { E: "1" },
  enabled: true,
};

const setServers = vi.fn();

function statusOf(config: McpServerConfig): McpServerStatus {
  return { config, state: "stopped", tools: [] };
}

async function mountWith(
  configs: McpServerConfig[],
  discovered: McpDiscoveredServer[] = [],
): Promise<VueWrapper> {
  // list 与 setServers 共享同一份可变状态，模拟真实主进程行为
  let statuses = configs.map(statusOf);
  setServers.mockImplementation(async (servers: McpServerConfig[]) => {
    statuses = servers.map(statusOf);
    return statuses;
  });
  vi.stubGlobal("zen", {
    mcp: {
      list: vi.fn().mockImplementation(async () => statuses),
      scan: vi.fn().mockResolvedValue(discovered),
      setServers,
    },
  });
  const wrapper = mount(SettingsMcp, { attachTo: document.body });
  await flushPromises();
  return wrapper;
}

function inputByPlaceholder(wrapper: VueWrapper, text: string): DOMWrapper<HTMLInputElement> {
  const input = wrapper
    .findAll("input")
    .find((item) => item.attributes("placeholder")?.includes(text));
  expect(input, `找不到 placeholder 含 ${text} 的输入框`).toBeTruthy();
  return input as DOMWrapper<HTMLInputElement>;
}

function buttonByText(wrapper: VueWrapper, text: string): DOMWrapper<HTMLButtonElement> {
  const button = wrapper.findAll("button").find((item) => item.text().includes(text));
  expect(button, `找不到文案含 ${text} 的按钮`).toBeTruthy();
  return button as DOMWrapper<HTMLButtonElement>;
}

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  setServers.mockReset();
});

afterEach(() => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
  disposePinia(pinia);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SettingsMcp 服务编辑", () => {
  it("扫描导入的服务与手动服务一样可编辑：保存保留 id/enabled 并更新字段", async () => {
    const wrapper = await mountWith([importedConfig]);

    const editButton = wrapper.find('button[aria-label="编辑 desk"]');
    expect(editButton.exists()).toBe(true);
    await editButton.trigger("click");

    // 进入编辑模式并预填
    expect(wrapper.text()).toContain("编辑服务");
    const name = inputByPlaceholder(wrapper, "名称");
    expect(name.element.value).toBe("desk");
    const command = inputByPlaceholder(wrapper, "启动命令");
    expect(command.element.value).toBe("desk-cmd");
    const env = inputByPlaceholder(wrapper, "环境变量");
    expect(env.element.value).toContain('"E": "1"');

    await name.setValue("desk-renamed");
    await command.setValue("new-cmd --flag");
    await env.setValue('{"E":"2"}');
    await buttonByText(wrapper, "保存").trigger("click");
    await flushPromises();

    expect(setServers).toHaveBeenCalledTimes(1);
    const saved = setServers.mock.calls[0]?.[0] as McpServerConfig[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      id: "srv-desk",
      name: "desk-renamed",
      transport: "stdio",
      command: "new-cmd",
      args: ["--flag"],
      env: { E: "2" },
      enabled: true,
    });
    wrapper.unmount();
  });

  it("编辑保存后重新扫描不回滚用户修改", async () => {
    const discovered: McpDiscoveredServer[] = [
      {
        config: { id: "scan-1", name: "desk", transport: "stdio", command: "desk-cmd", enabled: false },
        source: "Claude Desktop",
        sourcePath: "/home/u/Library/Application Support/Claude/claude_desktop_config.json",
        alreadyImported: true,
      },
    ];
    const wrapper = await mountWith([importedConfig], discovered);

    await wrapper.find('button[aria-label="编辑 desk"]').trigger("click");
    await inputByPlaceholder(wrapper, "名称").setValue("desk-renamed");
    await buttonByText(wrapper, "保存").trigger("click");
    await flushPromises();

    // 重扫只读：不再触发保存，列表仍显示编辑后的值
    await buttonByText(wrapper, "扫描当前仓库与系统").trigger("click");
    await flushPromises();

    expect(setServers).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("desk-renamed");
    wrapper.unmount();
  });

  it("取消编辑回到添加模式", async () => {
    const wrapper = await mountWith([importedConfig]);

    await wrapper.find('button[aria-label="编辑 desk"]').trigger("click");
    await buttonByText(wrapper, "取消").trigger("click");

    expect(wrapper.text()).toContain("添加服务");
    expect(wrapper.find('button[aria-label="编辑 desk"]').exists()).toBe(true);
    wrapper.unmount();
  });
});
