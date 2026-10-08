import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SettingsLark from "@/components/settings/SettingsLark.vue";
import { useAgentStore } from "@/stores/agent";

import type { VueWrapper } from "@vue/test-utils";
import type { LarkQuickCommand, LarkStatus } from "@zen/shared";

let pinia: ReturnType<typeof createPinia>;

const setSettings = vi.fn();

function larkStatusOf(patch: Partial<LarkStatus> = {}): LarkStatus {
  return {
    auth: {
      cliInstalled: true,
      available: true,
      version: "1.2.3",
      appId: "cli_app",
      brand: "feishu",
      botReady: true,
      userOpenId: "ou_1",
      userName: "张三",
      userAvatarUrl: null,
      error: null,
    },
    gateway: "ready",
    gatewayError: null,
    settings: { enabled: true, allowedOpenId: "ou_1", quickCommands: [] },
    ...patch,
  };
}

function stubZen(overrides: { status?: unknown; installCli?: unknown; testAskCard?: unknown } = {}) {
  const status = vi.fn().mockResolvedValue(overrides.status ?? larkStatusOf());
  const installCli = vi.fn().mockResolvedValue(overrides.installCli ?? { ok: true });
  const testAskCard = vi.fn().mockResolvedValue(overrides.testAskCard ?? { ok: true });
  // setSettings 返回合并后的完整设置，模拟主进程持久化
  setSettings.mockImplementation(async (partial: Record<string, unknown>) => ({
    larkBridge: { enabled: false, allowedOpenId: null, quickCommands: [] },
    ...partial,
  }));
  vi.stubGlobal("zen", {
    agent: {
      setSettings,
      getSettings: vi.fn(),
      onSettingsChanged: vi.fn().mockReturnValue(() => undefined),
      listSkills: vi.fn().mockResolvedValue([]),
    },
    lark: {
      status,
      installCli,
      testAskCard,
      onChanged: vi.fn().mockReturnValue(() => undefined),
    },
  });
  return { status, installCli, testAskCard };
}

/** 挂载前把快捷命令注入 agent store（组件从 settings.larkBridge.quickCommands 读取） */
async function mountWith(quickCommands: LarkQuickCommand[] = []): Promise<VueWrapper> {
  const agentStore = useAgentStore();
  agentStore.settings = {
    ...agentStore.settings,
    larkBridge: { enabled: true, allowedOpenId: "ou_1", quickCommands },
  };
  const wrapper = mount(SettingsLark, {
    global: { plugins: [pinia] },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

function inputByPlaceholder(wrapper: VueWrapper, text: string) {
  const input = wrapper
    .findAll("input")
    .find((item) => item.attributes("placeholder")?.includes(text));
  expect(input, `找不到 placeholder 含 ${text} 的输入框`).toBeTruthy();
  return input!;
}

function buttonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll("button").find((item) => item.text().trim() === text);
  expect(button, `找不到文案为 ${text} 的按钮`).toBeTruthy();
  return button!;
}

function savedQuickCommands(): Array<{ alias: string; label: string; prompt: string }> {
  const last = setSettings.mock.calls.at(-1)?.[0] as {
    larkBridge: { quickCommands: Array<{ alias: string; label: string; prompt: string }> };
  };
  return last.larkBridge.quickCommands;
}

beforeEach(() => {
  pinia = createPinia();
  setActivePinia(pinia);
  setSettings.mockReset();
});

afterEach(() => {
  document.body.innerHTML = "";
  disposePinia(pinia);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("SettingsLark 快捷命令 CRUD 与校验", () => {
  it("添加快捷命令：别名去前导斜杠，缺省 label 用别名，写入 larkBridge.quickCommands", async () => {
    stubZen();
    const wrapper = await mountWith();

    await inputByPlaceholder(wrapper, "别名，如 review").setValue("/review");
    await inputByPlaceholder(wrapper, "预设内容，如 审查当前分支改动").setValue("审查当前分支改动");
    await buttonByText(wrapper, "添加快捷命令").trigger("click");
    await flushPromises();

    expect(setSettings).toHaveBeenCalledTimes(1);
    const saved = savedQuickCommands();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      alias: "review",
      label: "review",
      prompt: "审查当前分支改动",
    });
    // 添加后表单清空
    expect(inputByPlaceholder(wrapper, "别名，如 review").element.value).toBe("");
    wrapper.unmount();
  });

  it("校验：别名与预设内容为空、别名含空格或斜杠、重名（大小写不敏感）均拒绝", async () => {
    stubZen();
    const wrapper = await mountWith([
      { id: "qc-1", alias: "review", label: "review", prompt: "审查" },
    ]);

    // 全空
    await buttonByText(wrapper, "添加快捷命令").trigger("click");
    expect(wrapper.text()).toContain("别名与预设内容不能为空");

    // 只填别名
    await inputByPlaceholder(wrapper, "别名，如 review").setValue("ok");
    await buttonByText(wrapper, "添加快捷命令").trigger("click");
    expect(wrapper.text()).toContain("别名与预设内容不能为空");

    // 别名含空格
    await inputByPlaceholder(wrapper, "别名，如 review").setValue("bad alias");
    await inputByPlaceholder(wrapper, "预设内容，如 审查当前分支改动").setValue("x");
    await buttonByText(wrapper, "添加快捷命令").trigger("click");
    expect(wrapper.text()).toContain("别名不能含空格或斜杠");

    // 别名含斜杠（去前导斜杠后仍含斜杠）
    await inputByPlaceholder(wrapper, "别名，如 review").setValue("a/b");
    await buttonByText(wrapper, "添加快捷命令").trigger("click");
    expect(wrapper.text()).toContain("别名不能含空格或斜杠");

    // 重名（大小写不敏感）
    await inputByPlaceholder(wrapper, "别名，如 review").setValue("REVIEW");
    await buttonByText(wrapper, "添加快捷命令").trigger("click");
    expect(wrapper.text()).toContain("别名 /REVIEW 已存在");

    expect(setSettings).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it("编辑：预填表单，保存保留 id 并允许自身别名不变；取消清空", async () => {
    stubZen();
    const wrapper = await mountWith([
      { id: "qc-1", alias: "review", label: "审查", prompt: "审查当前分支改动" },
    ]);

    // 列表展示别名与标签
    expect(wrapper.text()).toContain("/review");
    expect(wrapper.text()).toContain("· 审查");

    await wrapper.find('button[aria-label="编辑快捷命令"]').trigger("click");
    expect(inputByPlaceholder(wrapper, "别名，如 review").element.value).toBe("review");
    expect(inputByPlaceholder(wrapper, "按钮名（可选）").element.value).toBe("审查");
    expect(inputByPlaceholder(wrapper, "预设内容，如 审查当前分支改动").element.value).toBe(
      "审查当前分支改动",
    );

    // 编辑自身时同名不算冲突
    await inputByPlaceholder(wrapper, "预设内容，如 审查当前分支改动").setValue("新的预设");
    await buttonByText(wrapper, "保存修改").trigger("click");
    await flushPromises();

    expect(setSettings).toHaveBeenCalledTimes(1);
    const saved = savedQuickCommands();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ alias: "review", label: "审查", prompt: "新的预设" });
    expect(setSettings.mock.calls[0]?.[0]).toMatchObject({
      larkBridge: { quickCommands: [{ id: "qc-1" }] },
    });

    // 再次进入编辑后取消
    await wrapper.find('button[aria-label="编辑快捷命令"]').trigger("click");
    await buttonByText(wrapper, "取消").trigger("click");
    expect(inputByPlaceholder(wrapper, "别名，如 review").element.value).toBe("");
    wrapper.unmount();
  });

  it("删除快捷命令写入设置；删除正在编辑的条目同时退出编辑态", async () => {
    stubZen();
    const wrapper = await mountWith([
      { id: "qc-1", alias: "a", label: "a", prompt: "pa" },
      { id: "qc-2", alias: "b", label: "b", prompt: "pb" },
    ]);

    // 编辑 qc-1 后删除它 → 退出编辑态
    await wrapper.find('button[aria-label="编辑快捷命令"]').trigger("click");
    await wrapper.find('button[aria-label="删除快捷命令"]').trigger("click");
    await flushPromises();

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(savedQuickCommands().map((item) => item.alias)).toEqual(["b"]);
    expect(buttonByText(wrapper, "添加快捷命令").exists()).toBe(true);

    // 删除另一条不再进入编辑
    await wrapper.findAll('button[aria-label="删除快捷命令"]')[0]?.trigger("click");
    await flushPromises();
    expect(savedQuickCommands()).toHaveLength(0);
    wrapper.unmount();
  });
});

describe("SettingsLark 状态与测试卡片", () => {
  it("渲染回调配置指引与卡片回调说明", async () => {
    stubZen();
    const wrapper = await mountWith();

    expect(wrapper.text()).toContain("card.action.trigger");
    expect(wrapper.text()).toContain("回调配置");
    expect(wrapper.text()).toContain("im.message.receive_v1");
    wrapper.unmount();
  });

  it("状态面板渲染网关/账号/机器人标签与安全绑定", async () => {
    stubZen({ status: larkStatusOf({ gateway: "off", gatewayError: "端口被占用" }) });
    const wrapper = await mountWith();

    expect(wrapper.text()).toContain("lark-cli：已安装（1.2.3）");
    expect(wrapper.text()).toContain("账号：张三");
    expect(wrapper.text()).toContain("机器人身份：已就绪");
    expect(wrapper.text()).toContain("网关：未启动");
    expect(wrapper.text()).toContain("端口被占用");
    expect(wrapper.text()).toContain("App ID：cli_app");
    expect(wrapper.text()).toContain("安全绑定：ou_1");
    wrapper.unmount();
  });

  it("未安装 CLI 时展示一键安装，安装失败显示错误", async () => {
    const { installCli } = stubZen({
      status: larkStatusOf({
        auth: {
          cliInstalled: false,
          available: false,
          version: null,
          appId: null,
          brand: null,
          botReady: false,
          userOpenId: null,
          userName: null,
          userAvatarUrl: null,
          error: "未找到 lark-cli",
        },
      }),
      installCli: { ok: false, error: "网络不可达" },
    });
    const wrapper = await mountWith();

    expect(wrapper.text()).toContain("lark-cli：未安装");
    expect(wrapper.text()).toContain("未找到 lark-cli");

    await buttonByText(wrapper, "一键安装 lark-cli").trigger("click");
    await flushPromises();
    expect(installCli).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("网络不可达");
    wrapper.unmount();
  });

  it("重新检查刷新状态，异常时显示 actionError", async () => {
    const { status } = stubZen();
    const wrapper = await mountWith();

    await buttonByText(wrapper, "重新检查").trigger("click");
    await flushPromises();
    expect(status).toHaveBeenCalledWith(true);

    // status 抛异常
    status.mockRejectedValueOnce(new Error("检查失败"));
    await buttonByText(wrapper, "重新检查").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("检查失败");
    wrapper.unmount();
  });

  it("发送测试问询卡片：成功与失败给出对应提示", async () => {
    stubZen({ testAskCard: { ok: true } });
    let wrapper = await mountWith();
    expect(wrapper.text()).toContain("卡片按钮回调");

    await buttonByText(wrapper, "发送测试问询卡片").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("测试卡片已发送到飞书");
    expect(wrapper.text()).toContain("该问询已失效");
    wrapper.unmount();

    stubZen({ testAskCard: { ok: false, error: "未绑定 open_id" } });
    wrapper = await mountWith();
    await buttonByText(wrapper, "发送测试问询卡片").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("未绑定 open_id");
    wrapper.unmount();
  });

  it("lark IPC 缺失时操作按钮静默返回，不写状态", async () => {
    stubZen();
    const wrapper = await mountWith();
    // 移除 lark IPC 段后操作均直接返回
    vi.stubGlobal("zen", {
      agent: {
        setSettings,
        getSettings: vi.fn(),
        onSettingsChanged: vi.fn().mockReturnValue(() => undefined),
        listSkills: vi.fn().mockResolvedValue([]),
      },
    });

    await buttonByText(wrapper, "重新检查").trigger("click");
    await buttonByText(wrapper, "发送测试问询卡片").trigger("click");
    await flushPromises();
    expect(setSettings).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain("检查失败");
    wrapper.unmount();
  });

  it("安装 lark-cli 成功后自动刷新状态", async () => {
    const { installCli, status } = stubZen({
      status: larkStatusOf({
        auth: {
          cliInstalled: false,
          available: false,
          version: null,
          appId: null,
          brand: null,
          botReady: false,
          userOpenId: null,
          userName: null,
          userAvatarUrl: null,
          error: null,
        },
      }),
      installCli: { ok: true },
    });
    const wrapper = await mountWith();

    await buttonByText(wrapper, "一键安装 lark-cli").trigger("click");
    await flushPromises();
    expect(installCli).toHaveBeenCalledTimes(1);
    // 成功后触发 refreshStatus → status(refresh=true)
    expect(status).toHaveBeenCalledWith(true);
    wrapper.unmount();
  });

  it("编辑时填充按钮名标签，label 缺省回退别名", async () => {
    stubZen();
    const wrapper = await mountWith([
      { id: "qc-1", alias: "review", label: "review", prompt: "审查" },
    ]);

    await wrapper.find('button[aria-label="编辑快捷命令"]').trigger("click");
    await inputByPlaceholder(wrapper, "按钮名（可选）").setValue("审查按钮");
    await buttonByText(wrapper, "保存修改").trigger("click");
    await flushPromises();

    const saved = savedQuickCommands();
    expect(saved[0]?.label).toBe("审查按钮");
    wrapper.unmount();
  });

  it("启用开关写入 larkBridge.enabled", async () => {
    stubZen();
    const wrapper = await mountWith();

    // store 中 enabled=true，点击开关后翻转为 false
    const toggle = wrapper.find('button[aria-label="启用飞书桥接"]');
    expect(toggle.exists()).toBe(true);
    await toggle.trigger("click");
    await flushPromises();

    expect(setSettings).toHaveBeenCalledTimes(1);
    expect(setSettings.mock.calls[0]?.[0]).toMatchObject({ larkBridge: { enabled: false } });
    wrapper.unmount();
  });
});
