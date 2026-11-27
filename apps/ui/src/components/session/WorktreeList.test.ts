import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import WorktreeList from "@/components/session/WorktreeList.vue";

import type { RepoWorktree } from "@zen/shared";
import type { VueWrapper } from "@vue/test-utils";

const gitStoreMock = vi.hoisted(() => ({
  selectRepository: vi.fn(),
  openGitPanel: vi.fn(),
}));

vi.mock("@/stores/git", () => ({
  useGitStore: () => gitStoreMock,
}));

const repoPath = "/tmp/demo";

function wt(overrides: Partial<RepoWorktree> = {}): RepoWorktree {
  return {
    path: repoPath,
    branch: "main",
    head: "0123456789abcdef0123456789abcdef01234567",
    kind: "main",
    detached: false,
    bare: false,
    locked: false,
    prunable: false,
    missing: false,
    current: false,
    operable: true,
    ...overrides,
  };
}

const git = {
  worktrees: vi.fn(),
  removeWorktree: vi.fn(),
};
const shell = { showInFolder: vi.fn() };

function stubWorktrees(list: RepoWorktree[], error?: string) {
  git.worktrees.mockResolvedValue({
    repos: [{ repoPath, repoName: "demo", worktrees: list }],
    ...(error ? { error } : {}),
  });
}

function mountList() {
  return mount(WorktreeList, { props: { repoPath, repoName: "demo" } });
}

function headerOf(wrapper: VueWrapper) {
  return wrapper.find('button[aria-label="工作树"]');
}

async function expand(wrapper: VueWrapper) {
  await headerOf(wrapper).trigger("click");
  await flushPromises();
}

function row(wrapper: VueWrapper, path: string) {
  return wrapper.find(`[data-worktree-path="${path}"]`);
}

beforeEach(() => {
  vi.clearAllMocks();
  git.removeWorktree.mockResolvedValue({ ok: true });
  shell.showInFolder.mockResolvedValue({ ok: true });
  vi.stubGlobal("zen", { git, shell });
  stubWorktrees([
    wt(),
    wt({
      path: "/tmp/demo-wt",
      branch: "feature/agent",
      kind: "linked",
      sessionId: "session-1",
      current: true,
    }),
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorktreeList", () => {
  it("默认收起：只渲染标题行，不发请求", async () => {
    const wrapper = mountList();
    await flushPromises();

    expect(wrapper.text()).toContain("工作树");
    expect(headerOf(wrapper).attributes("aria-expanded")).toBe("false");
    expect(git.worktrees).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toContain("feature/agent");
    wrapper.unmount();
  });

  it("首次展开才请求，并显示数量与两行结构", async () => {
    const wrapper = mountList();
    await expand(wrapper);

    expect(git.worktrees).toHaveBeenCalledWith(repoPath, undefined);
    expect(headerOf(wrapper).attributes("aria-expanded")).toBe("true");
    // 计数徽标 = 2
    expect(wrapper.text()).toContain("2");
    expect(row(wrapper, "/tmp/demo-wt").text()).toContain("feature/agent");
    expect(row(wrapper, "/tmp/demo-wt").text()).toContain("/tmp/demo-wt");
    wrapper.unmount();
  });

  it("徽标覆盖主工作树 / Zen / 当前 / 已锁定 / 目录丢失", async () => {
    stubWorktrees([
      wt(),
      wt({ path: "/tmp/zen-wt", kind: "linked", sessionId: "s1", current: true }),
      wt({ path: "/tmp/locked-wt", kind: "linked", locked: true, lockReason: "CI 占用" }),
      wt({ path: "/tmp/gone-wt", kind: "linked", missing: true, operable: false }),
    ]);
    const wrapper = mountList();
    await expand(wrapper);

    expect(row(wrapper, repoPath).text()).toContain("主工作树");
    const zenRow = row(wrapper, "/tmp/zen-wt");
    expect(zenRow.text()).toContain("Zen");
    expect(zenRow.text()).toContain("当前");
    // current 行给浅底强调
    expect(zenRow.classes()).toContain("bg-[var(--color-sunken)]");
    expect(row(wrapper, repoPath).classes()).not.toContain("bg-[var(--color-sunken)]");

    const lockedRow = row(wrapper, "/tmp/locked-wt");
    expect(lockedRow.text()).toContain("已锁定");
    // 锁定原因走 title（窄栏里不额外占行）
    expect(lockedRow.find('[title="CI 占用"]').exists()).toBe(true);

    const goneRow = row(wrapper, "/tmp/gone-wt");
    expect(goneRow.text()).toContain("目录丢失");
    // 丢失目录：打开文件管理器禁用
    const reveal = goneRow.find('button[aria-label="在文件管理器中显示"]');
    expect(reveal.attributes("disabled")).toBeDefined();
    wrapper.unmount();
  });

  it("blockedReason 让删除按钮禁用并给出原因", async () => {
    stubWorktrees([wt({ blockedReason: "工作树内有未提交改动" })]);
    const wrapper = mountList();
    await expand(wrapper);

    const remove = row(wrapper, repoPath).find('button[aria-label="移除工作树"]');
    expect(remove.attributes("disabled")).toBeDefined();
    expect(remove.attributes("title")).toBe("工作树内有未提交改动");
    wrapper.unmount();
  });

  it("operable=false 时 Git 面板按钮禁用并说明原因", async () => {
    stubWorktrees([wt({ path: "/tmp/broken-wt", operable: false, blockedReason: "目录不可读" })]);
    const wrapper = mountList();
    await expand(wrapper);

    const open = row(wrapper, "/tmp/broken-wt").find('button[aria-label="在 Git 面板打开"]');
    expect(open.attributes("disabled")).toBeDefined();
    expect(open.attributes("title")).toContain("目录不可读");
    wrapper.unmount();
  });

  it("打开 Git 面板先选中该工作树路径", async () => {
    const wrapper = mountList();
    await expand(wrapper);

    await row(wrapper, "/tmp/demo-wt").find('button[aria-label="在 Git 面板打开"]').trigger("click");
    await flushPromises();

    expect(gitStoreMock.selectRepository).toHaveBeenCalledWith("/tmp/demo-wt");
    expect(gitStoreMock.openGitPanel).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("删除走确认弹窗，描述里带具体路径与分支", async () => {
    const wrapper = mountList();
    await expand(wrapper);

    await row(wrapper, "/tmp/demo-wt").find('button[aria-label="移除工作树"]').trigger("click");
    await flushPromises();

    expect(git.removeWorktree).not.toHaveBeenCalled();
    const dialog = wrapper.findComponent(ConfirmDialog);
    expect(dialog.props("open")).toBe(true);
    const description = String(dialog.props("description"));
    expect(description).toContain("/tmp/demo-wt");
    expect(description).toContain("feature/agent");
    expect(description).toContain("--force");
    wrapper.unmount();
  });

  it("确认后按 Git 登记路径调用 removeWorktree，成功后刷新列表", async () => {
    const wrapper = mountList();
    await expand(wrapper);

    await row(wrapper, "/tmp/demo-wt").find('button[aria-label="移除工作树"]').trigger("click");
    wrapper.findComponent(ConfirmDialog).vm.$emit("confirm");
    await flushPromises();

    expect(git.removeWorktree).toHaveBeenCalledWith(repoPath, "/tmp/demo-wt");
    expect(git.worktrees).toHaveBeenCalledTimes(2);
    expect(wrapper.findComponent(ConfirmDialog).props("open")).toBe(false);
    wrapper.unmount();
  });

  it("删除失败显示主进程原因且保留列表项", async () => {
    git.removeWorktree.mockResolvedValue({ ok: false, error: "工作树有未提交改动，git 拒绝移除" });
    const wrapper = mountList();
    await expand(wrapper);

    await row(wrapper, "/tmp/demo-wt").find('button[aria-label="移除工作树"]').trigger("click");
    wrapper.findComponent(ConfirmDialog).vm.$emit("confirm");
    await flushPromises();

    const alert = wrapper.find('[role="alert"]');
    expect(alert.exists()).toBe(true);
    expect(alert.text()).toContain("工作树有未提交改动，git 拒绝移除");
    expect(row(wrapper, "/tmp/demo-wt").exists()).toBe(true);
    // 失败不刷新（列表保持原状，避免把已消失的项藏起来）
    expect(git.worktrees).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("空数组时给出「只有主工作树」的空态", async () => {
    stubWorktrees([]);
    const wrapper = mountList();
    await expand(wrapper);

    expect(wrapper.text()).toContain("这个仓库只有主工作树");
    expect(wrapper.find('[data-worktree-path]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("收起时点刷新等于展开并加载", async () => {
    const wrapper = mountList();
    await wrapper.find('button[aria-label="刷新工作树"]').trigger("click");
    await flushPromises();

    expect(git.worktrees).toHaveBeenCalledTimes(1);
    expect(headerOf(wrapper).attributes("aria-expanded")).toBe("true");
    wrapper.unmount();
  });

  it("读取失败时在列表上方显示原因", async () => {
    stubWorktrees([], "not a git repository");
    const wrapper = mountList();
    await expand(wrapper);

    expect(wrapper.find('[role="alert"]').text()).toContain("not a git repository");
    wrapper.unmount();
  });
});
