import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import McpDialog from "@/components/sidebar/McpDialog.vue";

import type { DOMWrapper, VueWrapper } from "@vue/test-utils";
import type { McpDiscoveredServer, McpServerConfig, McpServerStatus, McpToolInfo } from "@zen/shared";

let pinia: ReturnType<typeof createPinia>;

const setServers = vi.fn();
const scan = vi.fn();
const authorize = vi.fn();

function statusOf(
  config: McpServerConfig,
  // 工具条目允许省略 serverId（由 helper 补齐），简化各用例的 fixture
  patch: Omit<Partial<McpServerStatus>, "tools"> & {
    tools?: Array<Omit<McpToolInfo, "serverId"> & { serverId?: string }>;
  } = {},
): McpServerStatus {
  // 工具条目按类型要求补齐 serverId（固定取 config.id）
  const { tools: toolFixtures, ...rest } = patch;
  const tools: McpToolInfo[] = (toolFixtures ?? []).map((tool) => ({
    serverId: config.id,
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));
  return { config, state: "stopped", tools, ...rest };
}

async function mountWith(
  statuses: McpServerStatus[],
  discovered: McpDiscoveredServer[] = [],
): Promise<VueWrapper> {
  let current = statuses;
  setServers.mockImplementation(async (servers: McpServerConfig[]) => {
    current = servers.map((config) => statusOf(config));
    return current;
  });
  scan.mockResolvedValue(discovered);
  vi.stubGlobal("zen", {
    agent: { setSettings: vi.fn(), listSkills: vi.fn().mockResolvedValue([]) },
    mcp: {
      list: vi.fn().mockImplementation(async () => current),
      setServers,
      scan,
      authorize,
    },
    workspace: { list: vi.fn().mockResolvedValue([]) },
    session: { create: vi.fn() },
    shell: { platformInfo: vi.fn().mockResolvedValue({}) },
  });
  const wrapper = mount(McpDialog, {
    props: { open: false },
    global: {
      plugins: [pinia],
      stubs: {
        Dialog: true,
        DialogContent: true,
        DialogHeader: true,
        DialogTitle: true,
        DialogDescription: true,
        // Select 是 reka-ui 组合件，用按钮桩驱动 transport 切换
        Select: {
          props: ["modelValue"],
          emits: ["update:modelValue"],
          template: `
            <div>
              <button type="button" data-transport="stdio" @click="$emit('update:modelValue', 'stdio')">切 stdio</button>
              <button type="button" data-transport="http" @click="$emit('update:modelValue', 'http')">切 http</button>
            </div>
          `,
        },
        SelectTrigger: true,
        SelectValue: true,
        SelectContent: true,
        SelectItem: true,
      },
      renderStubDefaultSlot: true,
    },
    attachTo: document.body,
  });
  await wrapper.setProps({ open: true });
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

function buttonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll("button").find((item) => item.text().trim() === text);
  expect(button, `找不到文案为 ${text} 的按钮`).toBeTruthy();
  return button!;
}

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
});

afterEach(() => {
  document.body.innerHTML = "";
  disposePinia(pinia);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("McpDialog 编辑表单", () => {
  const stdioConfig: McpServerConfig = {
    id: "srv-1",
    name: "filesystem",
    transport: "stdio",
    command: "npx",
    args: ["-y", "server-fs", "/path"],
    env: { E: "1" },
    enabled: true,
  };
  const httpConfig: McpServerConfig = {
    id: "srv-2",
    name: "remote",
    transport: "http",
    url: "https://mcp.example.com",
    headers: { Authorization: "Bearer x" },
    enabled: false,
  };

  it("编辑 stdio 服务：预填命令行与环境变量，保存保留 id/enabled", async () => {
    const wrapper = await mountWith([statusOf(stdioConfig)]);

    await wrapper.find('button[aria-label="编辑 filesystem"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("编辑服务");
    expect(inputByPlaceholder(wrapper, "名称").element.value).toBe("filesystem");
    expect(inputByPlaceholder(wrapper, "命令").element.value).toBe("npx -y server-fs /path");
    // input 值会剥掉换行（HTML 值净化），只断言 JSON 内容
    expect(inputByPlaceholder(wrapper, "环境变量").element.value).toContain('"E": "1"');

    await inputByPlaceholder(wrapper, "名称").setValue("filesystem-renamed");
    await inputByPlaceholder(wrapper, "命令").setValue("node fs.js");
    await buttonByText(wrapper, "保存").trigger("click");
    await flushPromises();

    expect(setServers).toHaveBeenCalledTimes(1);
    const saved = setServers.mock.calls[0]?.[0] as McpServerConfig[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      id: "srv-1",
      name: "filesystem-renamed",
      transport: "stdio",
      command: "node",
      args: ["fs.js"],
      enabled: true,
    });
    // 保存后回到添加模式
    expect(wrapper.text()).toContain("添加服务");
    wrapper.unmount();
  });

  it("编辑 http 服务：预填 url 与请求头，保存保留 enabled=false", async () => {
    const wrapper = await mountWith([statusOf(httpConfig)]);

    await wrapper.find('button[aria-label="编辑 remote"]').trigger("click");
    await flushPromises();

    expect(inputByPlaceholder(wrapper, "https://").element.value).toBe("https://mcp.example.com");
    expect(inputByPlaceholder(wrapper, "附加请求头").element.value).toContain('"Authorization": "Bearer x"');

    await buttonByText(wrapper, "保存").trigger("click");
    await flushPromises();

    const saved = setServers.mock.calls[0]?.[0] as McpServerConfig[];
    expect(saved[0]).toMatchObject({
      id: "srv-2",
      transport: "http",
      url: "https://mcp.example.com",
      headers: { Authorization: "Bearer x" },
      enabled: false,
    });
    wrapper.unmount();
  });

  it("取消编辑清空表单回到添加模式", async () => {
    const wrapper = await mountWith([statusOf(stdioConfig)]);

    await wrapper.find('button[aria-label="编辑 filesystem"]').trigger("click");
    await buttonByText(wrapper, "取消").trigger("click");

    expect(wrapper.text()).toContain("添加服务");
    expect(inputByPlaceholder(wrapper, "名称").element.value).toBe("");
    expect(setServers).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("添加校验：名称/命令/环境变量 JSON 均有错误提示且不落库", async () => {
    const wrapper = await mountWith([]);

    // 空名称
    await buttonByText(wrapper, "添加").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("请填写服务名称");
    expect(setServers).not.toHaveBeenCalled();

    // 空命令
    await inputByPlaceholder(wrapper, "名称").setValue("fs");
    await buttonByText(wrapper, "添加").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("请填写启动命令");

    // 环境变量非 JSON
    await inputByPlaceholder(wrapper, "命令").setValue("npx -y fs");
    await inputByPlaceholder(wrapper, "环境变量").setValue("not-json");
    await buttonByText(wrapper, "添加").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("环境变量不是合法 JSON");
    expect(setServers).not.toHaveBeenCalled();

    // 合法后成功添加
    await inputByPlaceholder(wrapper, "环境变量").setValue('{"K":"v"}');
    await buttonByText(wrapper, "添加").trigger("click");
    await flushPromises();
    expect(setServers).toHaveBeenCalledTimes(1);
    const saved = setServers.mock.calls[0]?.[0] as McpServerConfig[];
    expect(saved[0]).toMatchObject({ name: "fs", command: "npx", args: ["-y", "fs"], env: { K: "v" } });
    wrapper.unmount();
  });

  it("http 校验：地址须 http(s) 开头，请求头须合法 JSON", async () => {
    const wrapper = await mountWith([]);

    await buttonByText(wrapper, "切 http").trigger("click");
    await inputByPlaceholder(wrapper, "名称").setValue("remote");

    await buttonByText(wrapper, "添加").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("请填写 http(s):// 开头的服务地址");

    await inputByPlaceholder(wrapper, "https://").setValue("ftp://x");
    await buttonByText(wrapper, "添加").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("请填写 http(s):// 开头的服务地址");

    await inputByPlaceholder(wrapper, "https://").setValue("https://mcp.example.com");
    await inputByPlaceholder(wrapper, "附加请求头").setValue("{bad");
    await buttonByText(wrapper, "添加").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("请求头不是合法 JSON");
    expect(setServers).not.toHaveBeenCalled();

    await inputByPlaceholder(wrapper, "附加请求头").setValue('{"Authorization":"Bearer x"}');
    await buttonByText(wrapper, "添加").trigger("click");
    await flushPromises();
    const saved = setServers.mock.calls[0]?.[0] as McpServerConfig[];
    expect(saved[0]).toMatchObject({
      transport: "http",
      url: "https://mcp.example.com",
      headers: { Authorization: "Bearer x" },
    });
    wrapper.unmount();
  });

  it("保存传给 IPC 的载荷是可结构化克隆的纯对象（含既有服务的响应式条目）", async () => {
    const wrapper = await mountWith([statusOf(stdioConfig)]);

    await buttonByText(wrapper, "切 http").trigger("click");
    await inputByPlaceholder(wrapper, "名称").setValue("mobbin");
    await inputByPlaceholder(wrapper, "https://").setValue("https://api.mobbin.com/mcp");
    await buttonByText(wrapper, "添加").trigger("click");
    await flushPromises();

    expect(setServers).toHaveBeenCalledTimes(1);
    const saved = setServers.mock.calls[0]?.[0] as McpServerConfig[];
    // Vue 响应式 Proxy 无法穿过 contextBridge（structured clone 会抛错），载荷必须是纯对象
    expect(() => structuredClone(saved)).not.toThrow();
    expect(saved).toHaveLength(2);
    expect(saved[0]).toMatchObject({ id: "srv-1", name: "filesystem" });
    expect(saved[1]).toMatchObject({ name: "mobbin", transport: "http", url: "https://api.mobbin.com/mcp" });
    // 保存后表单复位
    expect(inputByPlaceholder(wrapper, "名称").element.value).toBe("");
    wrapper.unmount();
  });

  it("保存编辑时目标已不在列表则直接复位表单", async () => {
    const wrapper = await mountWith([statusOf(stdioConfig)]);

    await wrapper.find('button[aria-label="编辑 filesystem"]').trigger("click");
    // 列表被外部清空后保存 → cancelEdit 而非 setServers
    setServers.mockClear();
    (window as { zen?: { mcp?: { list?: unknown } } }).zen!.mcp!.list = vi.fn().mockResolvedValue([]);
    await buttonByText(wrapper, "刷新状态").trigger("click");
    await flushPromises();

    await buttonByText(wrapper, "保存").trigger("click");
    await flushPromises();
    expect(setServers).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("添加服务");
    wrapper.unmount();
  });

  it("移除服务：若正编辑该服务则先取消编辑", async () => {
    const wrapper = await mountWith([statusOf(stdioConfig)]);

    await wrapper.find('button[aria-label="编辑 filesystem"]').trigger("click");
    await wrapper.find('button[aria-label="移除服务"]').trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("添加服务");
    expect(setServers).toHaveBeenCalledTimes(1);
    expect(setServers.mock.calls[0]?.[0]).toHaveLength(0);
    wrapper.unmount();
  });
});

describe("McpDialog 工具列表与参数摘要", () => {
  const withTools: McpServerStatus = statusOf(
    {
      id: "srv-t",
      name: "tools",
      transport: "stdio",
      command: "tool-srv",
      args: [],
      enabled: true,
    },
    {
      state: "running",
      tools: [
        {
          name: "read_file",
          description: "读取文件",
          inputSchema: {
            type: "object",
            properties: { path: { type: "string" }, offset: { type: "number" } },
            required: ["path"],
          },
        },
        {
          name: "no_desc",
          description: "",
          inputSchema: { type: "object" },
        },
      ],
    },
  );

  it("工具明细默认收起，点击工具行展开描述与参数摘要", async () => {
    const wrapper = await mountWith([withTools]);

    // 默认只显示工具名，描述与参数收起
    expect(wrapper.text()).toContain("read_file");
    expect(wrapper.text()).not.toContain("读取文件");
    expect(wrapper.text()).not.toContain("参数：path: string，offset: number?");

    // 点击工具行展开
    const toolButton = wrapper.findAll("button").find((item) => item.text().includes("read_file"));
    expect(toolButton).toBeTruthy();
    await toolButton!.trigger("click");
    expect(wrapper.text()).toContain("读取文件");
    // 必填无问号，可选带问号
    expect(wrapper.text()).toContain("参数：path: string，offset: number?");

    // 无描述回退，schema 无 properties 时不渲染参数行
    const noDescButton = wrapper.findAll("button").find((item) => item.text().includes("no_desc"));
    expect(noDescButton).toBeTruthy();
    await noDescButton!.trigger("click");
    expect(wrapper.text()).toContain("无描述");
    expect(wrapper.text()).not.toContain("参数：…");

    // 再次点击收起
    await toolButton!.trigger("click");
    expect(wrapper.text()).not.toContain("读取文件");
    wrapper.unmount();
  });

  it("超过 6 个参数截断为前 6 个并加省略号", async () => {
    const props: Record<string, { type: string }> = {};
    for (const name of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      props[name] = { type: "string" };
    }
    const many: McpServerStatus = statusOf(
      { id: "srv-m", name: "many", transport: "stdio", command: "m", args: [], enabled: true },
      {
        state: "running",
        tools: [{ name: "many_args", description: "", inputSchema: { type: "object", properties: props } }],
      },
    );
    const wrapper = await mountWith([many]);

    // 展开工具明细后再断言参数摘要
    const toolButton = wrapper.findAll("button").find((item) => item.text().includes("many_args"));
    expect(toolButton).toBeTruthy();
    await toolButton!.trigger("click");

    const summary = wrapper.text().match(/参数：[^\n]+/)?.[0] ?? "";
    expect(summary).toContain("f: string");
    expect(summary.endsWith("…")).toBe(true);
    expect(summary).not.toContain("g:");
    wrapper.unmount();
  });

  it("工具面板可折叠切换，运行中无工具显示无工具", async () => {
    const emptyRunning = statusOf(
      { id: "srv-e", name: "empty", transport: "stdio", command: "e", args: [], enabled: true },
      { state: "running", tools: [] },
    );
    const wrapper = await mountWith([emptyRunning]);

    expect(wrapper.text()).toContain("无工具");

    const toggle = wrapper.find('button[aria-expanded="true"]');
    expect(toggle.exists()).toBe(true);
    await toggle.trigger("click");
    expect(wrapper.text()).not.toContain("无工具");
    expect(wrapper.find('button[aria-expanded="false"]').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe("McpDialog 状态、扫描与说明", () => {
  it("错误服务显示错误原因与错误状态文案，停止/启动中各有标签", async () => {
    const configs: McpServerConfig[] = [
      { id: "a", name: "err-srv", transport: "stdio", command: "x", args: [], enabled: true },
      { id: "b", name: "start-srv", transport: "stdio", command: "y", args: [], enabled: true },
      { id: "c", name: "stop-srv", transport: "stdio", command: "z", args: [], enabled: true },
    ];
    const wrapper = await mountWith([
      statusOf(configs[0]!, { state: "error", error: "spawn ENOENT" }),
      statusOf(configs[1]!, { state: "starting" }),
      statusOf(configs[2]!, { state: "stopped" }),
    ]);

    expect(wrapper.text()).toContain("spawn ENOENT");
    expect(wrapper.text()).toContain("错误");
    expect(wrapper.text()).toContain("启动中");
    expect(wrapper.text()).toContain("已停止");
    wrapper.unmount();
  });

  it("扫描发现可导入服务并跳过已导入/重名，逐个导入后提示已导入", async () => {
    const discovered: McpDiscoveredServer[] = [
      {
        config: { id: "d1", name: "codex-srv", transport: "stdio", command: "c1", args: ["--a"], enabled: true },
        source: "Codex",
        sourcePath: "/home/u/.codex/config.toml",
        alreadyImported: false,
      },
      {
        config: { id: "d2", name: "done-srv", transport: "http", url: "https://x", enabled: true },
        source: "Claude",
        sourcePath: "/home/u/.claude.json",
        alreadyImported: true,
      },
    ];
    const wrapper = await mountWith([], discovered);

    await buttonByText(wrapper, "扫描").trigger("click");
    await flushPromises();
    expect(scan).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("发现 2 个服务，其中 1 个未导入");
    expect(buttonByText(wrapper, "全部导入").exists()).toBe(true);

    await wrapper.find('button[aria-label="导入 codex-srv"]').trigger("click");
    await flushPromises();

    expect(setServers).toHaveBeenCalledTimes(1);
    const saved = setServers.mock.calls[0]?.[0] as McpServerConfig[];
    expect(saved.map((item) => item.name)).toEqual(["codex-srv"]);
    expect(wrapper.text()).toContain("已导入 codex-srv");
    // 已导入的条目不再显示导入按钮
    expect(wrapper.find('button[aria-label="导入 done-srv"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("全部导入跳过与现有服务重名的条目", async () => {
    const discovered: McpDiscoveredServer[] = [
      {
        config: { id: "d1", name: "fs", transport: "stdio", command: "c1", args: [], enabled: true },
        source: "Cursor",
        sourcePath: "/home/u/.cursor/mcp.json",
        alreadyImported: false,
      },
      {
        config: { id: "d2", name: "fresh", transport: "stdio", command: "c2", args: [], enabled: true },
        source: "Cursor",
        sourcePath: "/home/u/.cursor/mcp.json",
        alreadyImported: false,
      },
    ];
    const existing: McpServerConfig = {
      id: "dup",
      name: "fs",
      transport: "stdio",
      command: "old",
      args: [],
      enabled: true,
    };
    const wrapper = await mountWith([statusOf(existing)], discovered);

    await buttonByText(wrapper, "扫描").trigger("click");
    await flushPromises();
    await buttonByText(wrapper, "全部导入").trigger("click");
    await flushPromises();

    const saved = setServers.mock.calls.at(-1)?.[0] as McpServerConfig[];
    expect(saved.map((item) => item.name).sort()).toEqual(["fresh", "fs"]);
    expect(saved.find((item) => item.name === "fs")?.id).toBe("dup");
    wrapper.unmount();
  });

  it("扫描无结果与全部已导入时给出对应提示", async () => {
    let wrapper = await mountWith([]);
    await buttonByText(wrapper, "扫描").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("未在本机其它工具或当前仓库发现 MCP 配置");
    wrapper.unmount();

    wrapper = await mountWith([], [
      {
        config: { id: "d", name: "x", transport: "stdio", command: "c", args: [], enabled: true },
        source: "Codex",
        sourcePath: "/p",
        alreadyImported: true,
      },
    ]);
    await buttonByText(wrapper, "扫描").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("发现 1 个服务，其中 0 个未导入");
    // 全部已导入时不显示批量导入按钮
    expect(wrapper.findAll("button").some((b) => b.text().trim() === "全部导入")).toBe(false);
    wrapper.unmount();
  });

  it("主动调用说明渲染 mcp.服务.工具 与配置写入位置", async () => {
    const wrapper = await mountWith([]);
    expect(wrapper.text()).toContain("mcp.服务.工具");
    expect(wrapper.text()).toContain("~/.zen/mcp.json");
    // 空列表给出引导
    expect(wrapper.text()).toContain("尚未配置 MCP 服务。");
    wrapper.unmount();
  });

  it("未配置列表为空时显示引导文案，配置后计数更新", async () => {
    const config: McpServerConfig = {
      id: "s",
      name: "one",
      transport: "stdio",
      command: "c",
      args: [],
      enabled: true,
    };
    const wrapper = await mountWith([statusOf(config)]);
    expect(wrapper.text()).toContain("已配置 1 个服务");
    wrapper.unmount();
  });
});

describe("McpDialog needs-auth OAuth 授权", () => {
  const oauthConfig: McpServerConfig = {
    id: "srv-oauth",
    name: "remote-oauth",
    transport: "http",
    url: "https://mcp.example.com/mcp",
    enabled: true,
  };

  it("needs-auth 状态显示需要授权徽标与授权登录按钮", async () => {
    const wrapper = await mountWith([statusOf(oauthConfig, { state: "needs-auth" })]);

    expect(wrapper.text()).toContain("需要授权");
    const button = buttonByText(wrapper, "授权登录");
    expect(button.attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  it("点击授权登录调用 authorize(serverId)，resolve 后状态变为运行中", async () => {
    authorize.mockImplementation(async () => [
      statusOf(oauthConfig, {
        state: "running",
        tools: [{ name: "search", description: "搜索", inputSchema: { type: "object" } }],
      }),
    ]);
    const wrapper = await mountWith([statusOf(oauthConfig, { state: "needs-auth" })]);

    await buttonByText(wrapper, "授权登录").trigger("click");
    await flushPromises();

    expect(authorize).toHaveBeenCalledTimes(1);
    expect(authorize).toHaveBeenCalledWith("srv-oauth");
    expect(wrapper.text()).toContain("运行中");
    expect(wrapper.findAll("button").some((item) => item.text().trim() === "授权登录")).toBe(false);
    wrapper.unmount();
  });

  it("授权 reject 时按行展示错误且按钮恢复可点，重试成功后清除错误", async () => {
    authorize.mockRejectedValueOnce(new Error("授权超时/已取消"));
    const wrapper = await mountWith([statusOf(oauthConfig, { state: "needs-auth" })]);

    await buttonByText(wrapper, "授权登录").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("授权超时/已取消");
    expect(wrapper.text()).toContain("需要授权");
    const restored = buttonByText(wrapper, "授权登录");
    expect(restored.attributes("disabled")).toBeUndefined();

    authorize.mockResolvedValueOnce([statusOf(oauthConfig, { state: "running", tools: [] })]);
    await restored.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("运行中");
    expect(wrapper.text()).not.toContain("授权超时/已取消");
    wrapper.unmount();
  });
});
