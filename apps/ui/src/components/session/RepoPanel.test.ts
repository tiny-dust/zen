import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RepoPanel from "@/components/session/RepoPanel.vue";

import type { GitRepository, GitStatus } from "@zen/shared";

vi.mock("@/stores/git", () => ({
  useGitStore: () => ({
    repositories: [] as GitRepository[],
    repositoryBranches: {} as Record<string, string>,
    completionModel: () => ({ providerId: "p1", modelId: "m1" }),
    statusBadge: () => ({ text: "M", cls: "" }),
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

function mountPanel(open = true) {
  return mount(RepoPanel, {
    props: { repo, open },
    global: { stubs: { DiffView: true } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("zen", { git });
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

  it("点击变更文件用该仓库路径取 diff", async () => {
    const wrapper = mountPanel();
    await flushPromises();

    const row = wrapper.findAll("button").find((item) => item.text().includes("src/a.ts"));
    expect(row).toBeTruthy();
    await row!.trigger("click");
    await flushPromises();

    expect(git.diff).toHaveBeenCalledWith(repo.path, "src/a.ts");
  });

  it("提交按该仓库路径调用 commit，默认包含未暂存更改", async () => {
    const wrapper = mountPanel();
    await flushPromises();
    await wrapper.find("textarea").setValue("feat: panel");

    const commitButton = wrapper.findAll("button").find((item) => item.text() === "提交");
    expect(commitButton).toBeTruthy();
    await commitButton!.trigger("click");
    await flushPromises();

    expect(git.commit).toHaveBeenCalledWith(repo.path, "feat: panel", ["src/a.ts"], {
      push: false,
      includeUnstaged: true,
    });
  });

  it("「在 Git 面板打开」抛出仓库路径", async () => {
    const wrapper = mountPanel();
    await flushPromises();

    const openButton = wrapper.find('[aria-label="在 Git 面板打开"]');
    await openButton.trigger("click");

    expect(wrapper.emitted("openPanel")?.[0]).toEqual([repo.path]);
  });
});
