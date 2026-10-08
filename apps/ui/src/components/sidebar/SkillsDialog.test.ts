import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SkillsDialog from "@/components/sidebar/SkillsDialog.vue";

import type { VueWrapper } from "@vue/test-utils";
import type { SkillMarketHit, SkillSummary, SkillUpdateInfo } from "@zen/shared";

let pinia: ReturnType<typeof createPinia>;

const skillA: SkillSummary = {
  id: "/home/u/.claude/skills/coder",
  name: "coder",
  description: "编码入口",
  dir: "/home/u/.claude/skills/coder",
  source: "user",
  removable: true,
  disabled: false,
};
const skillB: SkillSummary = {
  id: "/home/u/.zen/skills/review",
  name: "review",
  description: "审查",
  dir: "/home/u/.zen/skills/review",
  source: "user",
  removable: true,
  disabled: false,
};

function updateInfo(skill: SkillSummary, hasUpdate: boolean): SkillUpdateInfo {
  return { id: skill.id, name: skill.name, dir: skill.dir, hasUpdate, via: "git", behind: hasUpdate ? 2 : 0 };
}

interface ZenMock {
  listSkills: ReturnType<typeof vi.fn>;
  setSettings: ReturnType<typeof vi.fn>;
  pickDirectory: ReturnType<typeof vi.fn>;
  mcpList: ReturnType<typeof vi.fn>;
  marketCheckUpdates: ReturnType<typeof vi.fn>;
  marketUpdate: ReturnType<typeof vi.fn>;
  marketSearch: ReturnType<typeof vi.fn>;
  marketInstall: ReturnType<typeof vi.fn>;
  uninstall: ReturnType<typeof vi.fn>;
}

function stubZen(overrides: Partial<ZenMock> = {}): ZenMock {
  const zen: ZenMock = {
    listSkills: vi.fn().mockResolvedValue([skillA, skillB]),
    setSettings: vi.fn().mockImplementation(async (partial: Record<string, unknown>) => ({
      skillExtraPaths: [],
      larkBridge: { enabled: false, allowedOpenId: null, quickCommands: [] },
      ...partial,
    })),
    pickDirectory: vi.fn().mockResolvedValue(null),
    mcpList: vi.fn().mockResolvedValue([]),
    marketCheckUpdates: vi.fn().mockResolvedValue({ ok: true, items: [] }),
    marketUpdate: vi.fn().mockResolvedValue({ ok: true }),
    marketSearch: vi.fn().mockResolvedValue({ ok: true, items: [] }),
    marketInstall: vi.fn().mockResolvedValue({ ok: true, dir: "/home/u/.claude/skills/hit" }),
    uninstall: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides,
  };
  vi.stubGlobal("zen", {
    agent: {
      listSkills: zen.listSkills,
      setSettings: zen.setSettings,
      pickDirectory: zen.pickDirectory,
    },
    mcp: { list: zen.mcpList },
    skills: {
      marketCheckUpdates: zen.marketCheckUpdates,
      marketUpdate: zen.marketUpdate,
      marketSearch: zen.marketSearch,
      marketInstall: zen.marketInstall,
      uninstall: zen.uninstall,
    },
  });
  return zen;
}

/** 弹窗内容经 Dialog 传送门渲染，stub 掉容器让断言留在 wrapper 内 */
async function mountDialog(): Promise<VueWrapper> {
  const wrapper = mount(SkillsDialog, {
    props: { open: false },
    global: {
      plugins: [pinia],
      stubs: {
        Dialog: true,
        DialogContent: true,
        DialogHeader: true,
        DialogTitle: true,
        DialogDescription: true,
      },
      renderStubDefaultSlot: true,
    },
    attachTo: document.body,
  });
  await flushPromises();
  return wrapper;
}

const newTask = vi.fn();
const send = vi.fn();
const setActive = vi.fn();

vi.mock("@/stores/chat", () => ({
  useChatStore: () => ({ input: "", newTask, send }),
}));
vi.mock("@/stores/workspace", () => ({
  useWorkspaceStore: () => ({ setActive }),
}));

/** 打开弹窗触发 watch(open) → refreshAll */
async function openDialog(): Promise<VueWrapper> {
  const wrapper = await mountDialog();
  await wrapper.setProps({ open: true });
  await flushPromises();
  return wrapper;
}

function buttonByText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll("button").find((item) => item.text().trim() === text);
  expect(button, `找不到文案为 ${text} 的按钮`).toBeTruthy();
  return button!;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
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

describe("SkillsDialog 更新反馈", () => {
  it("打开弹窗刷新并显示可更新数量与可更新徽标", async () => {
    stubZen({
      marketCheckUpdates: vi.fn().mockResolvedValue({
        ok: true,
        items: [updateInfo(skillA, true), updateInfo(skillB, true)],
      }),
    });
    const wrapper = await openDialog();

    expect(wrapper.text()).toContain("发现 2 个技能可更新");
    expect(wrapper.text()).toContain("可更新");
    expect(buttonByText(wrapper, "全部更新").exists()).toBe(true);
    wrapper.unmount();
  });

  it("单个更新成功：行内显示更新成功，刷新后状态为已是最新", async () => {
    const zen = stubZen({
      marketCheckUpdates: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          items: [updateInfo(skillA, true), updateInfo(skillB, false)],
        })
        .mockResolvedValue({ ok: true, items: [updateInfo(skillA, false), updateInfo(skillB, false)] }),
    });
    const wrapper = await openDialog();

    await buttonByText(wrapper, "更新").trigger("click");
    await flushPromises();

    expect(zen.marketUpdate).toHaveBeenCalledTimes(1);
    expect((zen.marketUpdate.mock.calls[0]?.[0] as SkillSummary).name).toBe("coder");
    expect(wrapper.text()).toContain("更新成功");
    expect(wrapper.text()).toContain("已是最新");
    wrapper.unmount();
  });

  it("单个更新失败：行内显示失败原因并截断超长消息，title 保留完整原因", async () => {
    const longError = `git pull 失败：${"x".repeat(120)}`;
    stubZen({
      marketCheckUpdates: vi.fn().mockResolvedValue({
        ok: true,
        items: [updateInfo(skillA, true), updateInfo(skillB, false)],
      }),
      marketUpdate: vi.fn().mockResolvedValue({ ok: false, error: longError }),
    });
    const wrapper = await openDialog();

    await buttonByText(wrapper, "更新").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("更新失败：");
    expect(wrapper.text()).toContain("…");
    expect(wrapper.text()).not.toContain(longError);
    const failed = wrapper.findAll("p").find((p) => p.text().startsWith("更新失败"));
    expect(failed?.attributes("title")).toBe(longError);
    wrapper.unmount();
  });

  it("单个更新抛异常：显示异常消息", async () => {
    stubZen({
      marketCheckUpdates: vi.fn().mockResolvedValue({
        ok: true,
        items: [updateInfo(skillA, true), updateInfo(skillB, false)],
      }),
      marketUpdate: vi.fn().mockRejectedValue(new Error("网络中断")),
    });
    const wrapper = await openDialog();

    await buttonByText(wrapper, "更新").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("更新失败：网络中断");
    wrapper.unmount();
  });

  it("marketUpdate IPC 缺失：更新失败并提示 IPC 不可用", async () => {
    stubZen({
      marketCheckUpdates: vi.fn().mockResolvedValue({
        ok: true,
        items: [updateInfo(skillA, true), updateInfo(skillB, false)],
      }),
    });
    // 覆盖为缺少 marketUpdate 的 skills 段
    const original = (window as { zen?: Record<string, unknown> }).zen!;
    vi.stubGlobal("zen", {
      ...original,
      skills: { marketCheckUpdates: (original.skills as Record<string, unknown>).marketCheckUpdates },
    });
    const wrapper = await openDialog();

    await buttonByText(wrapper, "更新").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("更新失败：技能市场 IPC 不可用");
    wrapper.unmount();
  });

  it("全部更新串行执行：前一个完成前不发起下一个，进度 1/2", async () => {
    const calls: Array<ReturnType<typeof deferred<{ ok: boolean }>>> = [];
    const zen = stubZen({
      marketCheckUpdates: vi.fn().mockResolvedValue({
        ok: true,
        items: [updateInfo(skillA, true), updateInfo(skillB, true)],
      }),
      marketUpdate: vi.fn().mockImplementation(() => {
        const d = deferred<{ ok: boolean }>();
        calls.push(d);
        return d.promise;
      }),
    });
    const wrapper = await openDialog();

    await buttonByText(wrapper, "全部更新").trigger("click");
    await flushPromises();

    // 串行：第一个未完成时不发起第二个
    expect(zen.marketUpdate).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain("更新中 1/2");
    expect(buttonByText(wrapper, "更新中 1/2").attributes("disabled")).toBeDefined();

    calls[0]!.resolve({ ok: true });
    await flushPromises();
    expect(zen.marketUpdate).toHaveBeenCalledTimes(2);

    calls[1]!.resolve({ ok: true });
    await flushPromises();

    expect(wrapper.text()).toContain("已更新 2 个");
    expect(wrapper.text()).not.toContain("失败");
    wrapper.unmount();
  });

  it("全部更新汇总成功与失败数量", async () => {
    stubZen({
      marketCheckUpdates: vi.fn().mockResolvedValue({
        ok: true,
        items: [updateInfo(skillA, true), updateInfo(skillB, true)],
      }),
      marketUpdate: vi.fn().mockImplementation(async (skill: SkillSummary) =>
        skill.id === skillA.id ? { ok: true } : { ok: false, error: "上游 403" },
      ),
    });
    const wrapper = await openDialog();

    await buttonByText(wrapper, "全部更新").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("已更新 1 个，失败 1 个");
    expect(wrapper.text()).toContain("更新失败：上游 403");
    wrapper.unmount();
  });

  it("全部更新时单项更新按钮被禁用，避免并发", async () => {
    const gate = deferred<{ ok: boolean }>();
    stubZen({
      marketCheckUpdates: vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          items: [updateInfo(skillA, true), updateInfo(skillB, true)],
        })
        .mockResolvedValue({ ok: true, items: [updateInfo(skillA, false), updateInfo(skillB, false)] }),
      marketUpdate: vi.fn().mockImplementation(() => gate.promise),
    });
    const wrapper = await openDialog();

    await buttonByText(wrapper, "全部更新").trigger("click");
    await flushPromises();

    const itemUpdate = buttonByText(wrapper, "更新");
    expect(itemUpdate.attributes("disabled")).toBeDefined();
    gate.resolve({ ok: true });
    await flushPromises();
    // 批次结束刷新后已无更新项，行内更新按钮随之消失
    expect(wrapper.findAll("button").some((b) => b.text().trim() === "更新")).toBe(false);
    wrapper.unmount();
  });
});

describe("SkillsDialog 状态文案", () => {
  it("刷新中显示进行中提示，缺少上游检测通道时提示已刷新本地技能", async () => {
    const zen = stubZen();
    // skills 段不含 marketCheckUpdates
    vi.stubGlobal("zen", {
      agent: {
        listSkills: zen.listSkills,
        setSettings: zen.setSettings,
        pickDirectory: zen.pickDirectory,
      },
      mcp: { list: zen.mcpList },
      skills: { marketSearch: zen.marketSearch },
    });
    // listSkills 挂起，让「进行中」提示可被观测
    const skillsGate = deferred<SkillSummary[]>();
    zen.listSkills.mockImplementation(() => skillsGate.promise);
    const wrapper = await mountDialog();

    await wrapper.setProps({ open: true });
    expect(wrapper.text()).toContain("正在刷新并检查上游更新…");

    skillsGate.resolve([skillA, skillB]);
    await flushPromises();
    expect(wrapper.text()).toContain("已刷新本地技能");
    wrapper.unmount();
  });

  it("上游检测失败显示 error，未失败且无可更新时显示已是最新", async () => {
    stubZen({
      marketCheckUpdates: vi.fn().mockResolvedValue({ ok: false, items: [], error: "skills.sh 不可达" }),
    });
    let wrapper = await openDialog();
    expect(wrapper.text()).toContain("skills.sh 不可达");
    wrapper.unmount();

    stubZen({
      marketCheckUpdates: vi.fn().mockResolvedValue({ ok: true, items: [updateInfo(skillA, false)] }),
    });
    wrapper = await openDialog();
    expect(wrapper.text()).toContain("已是最新");
    wrapper.unmount();
  });

  it("上游检测抛异常与过期刷新丢弃：仅最新一轮结果生效", async () => {
    // 场景一：抛异常
    stubZen({
      marketCheckUpdates: vi.fn().mockRejectedValue(new Error("DNS 解析失败")),
    });
    let wrapper = await openDialog();
    expect(wrapper.text()).toContain("DNS 解析失败");
    wrapper.unmount();

    // 场景二：慢的旧刷新结果晚到，被序号守卫丢弃
    const slow = deferred<{ ok: boolean; items: SkillUpdateInfo[] }>();
    const slowCheck = vi.fn().mockImplementation(() => slow.promise);
    stubZen({
      listSkills: vi.fn().mockResolvedValue([skillA, skillB]),
      marketCheckUpdates: slowCheck,
    });
    wrapper = await mountDialog();
    await wrapper.setProps({ open: true });
    await flushPromises();

    // 第二轮刷新（重开弹窗）换用快速通道；此时第一轮仍挂在 slow 上
    const zen2 = (window as { zen?: { skills?: { marketCheckUpdates?: unknown } } }).zen!;
    (zen2.skills as { marketCheckUpdates: unknown }).marketCheckUpdates = vi.fn().mockResolvedValue({
      ok: true,
      items: [updateInfo(skillA, true), updateInfo(skillB, false)],
    });
    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    expect(wrapper.text()).toContain("发现 1 个技能可更新");

    // 过期的第一轮结果此刻才返回，应被丢弃
    slow.resolve({ ok: true, items: [updateInfo(skillA, false), updateInfo(skillB, true)] });
    await flushPromises();
    expect(wrapper.text()).toContain("发现 1 个技能可更新");
    expect(wrapper.text()).toContain("可更新");
    wrapper.unmount();
  });

  it("关闭再打开清空行内更新结果", async () => {
    stubZen({
      marketCheckUpdates: vi.fn().mockResolvedValue({
        ok: true,
        items: [updateInfo(skillA, true), updateInfo(skillB, false)],
      }),
      marketUpdate: vi.fn().mockResolvedValue({ ok: true }),
    });
    const wrapper = await openDialog();
    await buttonByText(wrapper, "更新").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("更新成功");

    await wrapper.setProps({ open: false });
    await wrapper.setProps({ open: true });
    await flushPromises();
    expect(wrapper.text()).not.toContain("更新成功");
    wrapper.unmount();
  });
});

describe("SkillsDialog 一键分析", () => {
  it("点击一键分析：关弹窗、公共区新会话并发送分析提示词", async () => {
    stubZen();
    const wrapper = await openDialog();

    await buttonByText(wrapper, "一键分析").trigger("click");
    await flushPromises();

    expect(setActive).toHaveBeenCalledWith("common");
    expect(newTask).toHaveBeenCalledWith("common");
    expect(send).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });
});

describe("SkillsDialog 市场与卸载", () => {
  const hit: SkillMarketHit = {
    id: "hit-1",
    skillId: "frontend-design",
    name: "frontend-design",
    source: "vercel-labs",
    installs: 12345,
  };

  async function openMarket(wrapper: VueWrapper) {
    await buttonByText(wrapper, "市场 skills.sh").trigger("click");
    await flushPromises();
  }

  it("搜索市场展示结果、安装量与已安装徽标", async () => {
    stubZen({
      marketSearch: vi.fn().mockResolvedValue({ ok: true, items: [hit] }),
    });
    const wrapper = await openDialog();
    await openMarket(wrapper);

    const searchButton = buttonByText(wrapper, "搜索");
    await searchButton.trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("frontend-design");
    expect(wrapper.text()).toContain("12,345");
    // 本地 skill 名/coder 与 hit 不匹配 → 显示安装按钮
    expect(buttonByText(wrapper, "安装").exists()).toBe(true);

    // 名称与本地技能命中时显示已安装徽标
    const zen = (window as { zen?: { skills?: { marketSearch?: unknown } } }).zen!;
    (zen.skills as { marketSearch: unknown }).marketSearch = vi.fn().mockResolvedValue({
      ok: true,
      items: [{ ...hit, id: "hit-2", skillId: "coder", name: "Coder" }],
    });
    await buttonByText(wrapper, "搜索").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("已安装");
    wrapper.unmount();
  });

  it("搜索失败与 IPC 缺失显示市场错误", async () => {
    stubZen({
      marketSearch: vi.fn().mockResolvedValue({ ok: false, items: [], error: "搜索失败" }),
    });
    let wrapper = await openDialog();
    await openMarket(wrapper);
    await buttonByText(wrapper, "搜索").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("搜索失败");
    wrapper.unmount();

    vi.stubGlobal("zen", undefined);
    wrapper = await openDialog();
    await openMarket(wrapper);
    await buttonByText(wrapper, "搜索").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("技能市场 IPC 不可用");
    wrapper.unmount();
  });

  it("安装成功切回已安装页并提示目录，失败显示错误", async () => {
    stubZen({
      marketSearch: vi.fn().mockResolvedValue({ ok: true, items: [hit] }),
      marketInstall: vi.fn().mockResolvedValue({ ok: true, dir: "/home/u/.claude/skills/frontend-design" }),
    });
    const wrapper = await openDialog();
    await openMarket(wrapper);
    await buttonByText(wrapper, "搜索").trigger("click");
    await flushPromises();

    await buttonByText(wrapper, "安装").trigger("click");
    await flushPromises();

    expect(wrapper.text()).toContain("已安装 frontend-design → /home/u/.claude/skills/frontend-design");
    // 跳回已安装页
    expect(wrapper.text()).toContain("扫描目录与自定义路径");
    wrapper.unmount();

    const zen = stubZen({
      marketSearch: vi.fn().mockResolvedValue({ ok: true, items: [hit] }),
      marketInstall: vi.fn().mockRejectedValue(new Error("克隆超时")),
    });
    const wrapper2 = await openDialog();
    await openMarket(wrapper2);
    await buttonByText(wrapper2, "搜索").trigger("click");
    await flushPromises();
    await buttonByText(wrapper2, "安装").trigger("click");
    await flushPromises();
    expect(zen.marketInstall).toHaveBeenCalled();
    expect(wrapper2.text()).toContain("克隆超时");
    wrapper2.unmount();
  });

  it("卸载调用 IPC 并刷新列表；异常时显示错误原因", async () => {
    const zen = stubZen({ uninstall: vi.fn().mockResolvedValue({ ok: true }) });
    let wrapper = await openDialog();
    await wrapper.find('button[aria-label="卸载 coder"]').trigger("click");
    await flushPromises();
    expect(zen.uninstall).toHaveBeenCalledTimes(1);
    // 卸载成功文案在刷新完成后保持可见
    expect(wrapper.text()).toContain("已卸载 coder");
    wrapper.unmount();

    // uninstall 抛异常时错误原因进入 statusMsg 且不再刷新，可被看到
    stubZen({ uninstall: vi.fn().mockRejectedValue(new Error("目录被占用")) });
    wrapper = await openDialog();
    await wrapper.find('button[aria-label="卸载 coder"]').trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("目录被占用");
    wrapper.unmount();
  });

  it("添加扫描目录：跳过空路径与重复路径，选目录与输入路径均可写入设置", async () => {
    const zen = stubZen({
      pickDirectory: vi.fn().mockResolvedValue(null),
    });
    const wrapper = await openDialog();

    // pickDirectory 返回空且回退输入框为空 → 不保存
    await buttonByText(wrapper, "添加目录").trigger("click");
    await flushPromises();
    expect(zen.setSettings).not.toHaveBeenCalled();

    const input = wrapper
      .findAll("input")
      .find((item) => item.attributes("placeholder")?.includes("或输入路径"));
    expect(input).toBeTruthy();
    await input!.setValue("~/dup");
    await buttonByText(wrapper, "添加目录").trigger("click");
    await flushPromises();
    expect(zen.setSettings).toHaveBeenCalledTimes(1);

    // 重复路径不再写入
    await input!.setValue("~/dup");
    await buttonByText(wrapper, "添加目录").trigger("click");
    await flushPromises();
    expect(zen.setSettings).toHaveBeenCalledTimes(1);

    // 选择目录返回的路径也走同一保存链路
    zen.pickDirectory.mockResolvedValue("~/picked");
    await buttonByText(wrapper, "添加目录").trigger("click");
    await flushPromises();
    expect(zen.setSettings).toHaveBeenCalledTimes(2);
    wrapper.unmount();
  });
});
