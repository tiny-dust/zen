import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RepoPanel from "@/components/session/RepoPanel.vue";

import type { GitRepository, GitStatus } from "@zen/shared";

const gitStoreMock = vi.hoisted(() => ({
  selectRepository: vi.fn(),
  openFileTab: vi.fn(),
  openGitPanel: vi.fn(),
}));

vi.mock("@/stores/git", () => ({
  useGitStore: () => ({
    ...gitStoreMock,
    repositories: [] as GitRepository[],
    repositoryBranches: {} as Record<string, string>,
    completionModel: () => ({ providerId: "p1", modelId: "m1" }),
    statusBadge: () => ({ text: "M", cls: "" }),
    cwd: () => "/tmp/demo",
  }),
}));

const repo: GitRepository = {
  path: "/tmp/demo",
  relativePath: ".",
  name: "demo",
};

const status: GitStatus = {
  branch: "feature/repo-panel",
  files: [{ path: "src/a.ts", x: " ", y: "M", add: 3, del: 1, untracked: false }],
};

const git = {
  status: vi.fn().mockResolvedValue(status),
  branches: vi.fn().mockResolvedValue({
    local: [{ name: "feature/repo-panel", current: true }],
    remote: [{ name: "origin/main" }],
  }),
  pr: vi.fn().mockResolvedValue({ number: 42, title: "Repo panels", url: "https://example.com/pr/42" }),
  stashList: vi.fn().mockResolvedValue([]),
  diff: vi.fn().mockResolvedValue("diff --git a/src/a.ts b/src/a.ts\n+hello"),
  commit: vi.fn().mockResolvedValue({ ok: true }),
  commitBatched: vi.fn().mockResolvedValue({ ok: true, batches: [] }),
  push: vi.fn().mockResolvedValue({ ok: true }),
  pull: vi.fn().mockResolvedValue({ ok: true }),
  fetch: vi.fn().mockResolvedValue({ ok: true }),
  checkout: vi.fn().mockResolvedValue({ ok: true }),
  createBranch: vi.fn().mockResolvedValue({ ok: true }),
  merge: vi.fn().mockResolvedValue({ ok: true }),
  stashPush: vi.fn().mockResolvedValue({ ok: true }),
  stashApply: vi.fn().mockResolvedValue({ ok: true }),
  stashDrop: vi.fn().mockResolvedValue({ ok: true }),
  aiMessage: vi.fn().mockResolvedValue("feat: repo panel"),
};

/** attachToBody: 下拉菜单内容会 teleport 到 body，断言菜单项时需要真实挂载 */
function mountPanel(open = true, attachToBody = false) {
  return mount(RepoPanel, {
    props: { repo, open },
    global: { stubs: { DiffView: true } },
    ...(attachToBody ? { attachTo: document.body } : {}),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("zen", { git, window: { getPlatform: () => "darwin" } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RepoPanel 单仓库面板", () => {
  it("展开后按仓库路径加载分支、变更与 PR", async () => {
    const wrapper = mountPanel();
    await flushPromises();

    expect(git.status).toHaveBeenCalledWith(repo.path);
    expect(git.branches).toHaveBeenCalledWith(repo.path);
    expect(git.pr).toHaveBeenCalledWith(repo.path);
    expect(wrapper.text()).toContain("feature/repo-panel");
    expect(wrapper.text()).toContain("src/a.ts");
    expect(wrapper.text()).toContain("PR #42");
  });

  it("折叠时不发请求，展开后才加载", async () => {
    const wrapper = mountPanel(false);
    await flushPromises();
    expect(git.status).not.toHaveBeenCalled();

    await wrapper.setProps({ open: true });
    await flushPromises();
    expect(git.status).toHaveBeenCalledWith(repo.path);
  });

  it("变更文件分组可独立折叠展开", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    expect(wrapper.text()).toContain("src/a.ts");

    const header = wrapper.findAll("button").find((item) => item.text().includes("变更文件"));
    expect(header).toBeTruthy();
    await header!.trigger("click");
    await flushPromises();
    expect(header!.attributes("aria-expanded")).toBe("false");
    expect(wrapper.text()).not.toContain("src/a.ts");

    await header!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("src/a.ts");
    wrapper.unmount();
  });

  it("点击变更文件在右侧面板打开该仓库的 diff", async () => {
    const wrapper = mountPanel();
    await flushPromises();

    const row = wrapper.findAll("button").find((item) => item.text().includes("src/a.ts"));
    expect(row).toBeTruthy();
    await row!.trigger("click");
    await flushPromises();

    expect(gitStoreMock.selectRepository).toHaveBeenCalledWith(repo.path);
    expect(gitStoreMock.openFileTab).toHaveBeenCalledWith("src/a.ts");
    expect(gitStoreMock.openGitPanel).toHaveBeenCalledTimes(1);
    // 面板内不再内联渲染 diff
    expect(wrapper.text()).not.toContain("diff --git");
  });

  it("提交按该仓库路径调用 commit，默认包含未暂存更改", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.find("textarea").setValue("feat: panel");

    // 操作栏是纯 icon：按 aria-label 定位提交按钮
    const commitButton = wrapper.find('[aria-label="提交"]');
    expect(commitButton.exists()).toBe(true);
    await commitButton.trigger("click");
    await flushPromises();

    expect(git.commit).toHaveBeenCalledWith(repo.path, "feat: panel", ["src/a.ts"], {
      push: false,
      includeUnstaged: true,
    });
  });

  it("面板展开时轮询 status（工作树里 Agent 的改动会自动出现）", async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountPanel();
      await flushPromises();
      expect(git.status).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(3000);
      await flushPromises();
      expect(git.status.mock.calls.length).toBeGreaterThanOrEqual(2);
      wrapper.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("仓库位于会话工作树时标注「工作树」", async () => {
    const wrapper = mount(RepoPanel, {
      props: { repo, open: true, worktreePath: "/tmp/demo" },
    });
    await flushPromises();
    expect(wrapper.text()).toContain("工作树");
    wrapper.unmount();
  });

  it("「在 Git 面板打开」抛出仓库路径", async () => {
    const wrapper = mountPanel();
    await flushPromises();

    const openButton = wrapper.find('[aria-label="在 Git 面板打开"]');
    await openButton.trigger("click");

    expect(wrapper.emitted("openPanel")?.[0]).toEqual([repo.path]);
  });

  it("新建分支默认基于当前分支（不传基分支）", async () => {
    const wrapper = mountPanel();
    await flushPromises();

    await wrapper.find('[aria-label="新建分支"]').trigger("click");
    await wrapper.find("input").setValue("feature/new");
    await wrapper.find('[aria-label="创建"]').trigger("click");
    await flushPromises();

    expect(git.createBranch).toHaveBeenCalledWith(repo.path, "feature/new", undefined);
  });

  it("新建分支可指定远程分支作为基线", async () => {
    const wrapper = mountPanel(true, true);
    await flushPromises();

    await wrapper.find('[aria-label="新建分支"]').trigger("click");
    await wrapper.find("input").setValue("feature/from-origin");
    await wrapper.find('[aria-label="基分支"]').trigger("click");
    await flushPromises();

    const remoteItem = Array.from(document.querySelectorAll("[role=menuitem]")).find((item) =>
      item.textContent?.includes("origin/main"),
    );
    expect(remoteItem).toBeTruthy();
    (remoteItem as HTMLElement).click();
    await flushPromises();

    await wrapper.find('[aria-label="创建"]').trigger("click");
    await flushPromises();

    expect(git.createBranch).toHaveBeenCalledWith(repo.path, "feature/from-origin", "origin/main");
  });

  it("⌘↵ 触发提交，输入框里只保留提交手势", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.find("textarea").setValue("feat: shortcut");

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
    await flushPromises();

    expect(git.commit).toHaveBeenCalledWith(repo.path, "feat: shortcut", ["src/a.ts"], {
      push: false,
      includeUnstaged: true,
    });
    wrapper.unmount();
  });
});
