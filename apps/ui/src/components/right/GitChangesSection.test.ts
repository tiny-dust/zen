import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it, vi } from "vitest";

import GitChangesSection from "./GitChangesSection.vue";
import { useGitStore } from "@/stores/git";

import type { GitFileChange } from "@zen/shared";

function change(partial: Partial<GitFileChange> & { path: string }): GitFileChange {
  return { x: " ", y: " ", add: 1, del: 0, untracked: false, ...partial };
}

/** 挂载前先建 store 并写入 status（store 的 scope watch 只在创建时跑一次，不会覆盖） */
function mountSection(files: GitFileChange[]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const store = useGitStore();
  store.status = { branch: "main", files };
  const wrapper = mount(GitChangesSection, {
    props: { open: true },
    global: { plugins: [pinia] },
  });
  return { wrapper, store };
}

const FILES = [
  change({ path: "src/conflict.ts", x: "U", y: "U" }),
  change({ path: "src/staged.ts", x: "M", y: " " }),
  change({ path: "src/partly.ts", x: "M", y: "M" }),
  change({ path: "src/working.ts", x: " ", y: "M" }),
  change({ path: "src/fresh.ts", x: "?", y: "?", untracked: true }),
];

describe("GitChangesSection 三段分组", () => {
  it("按 合并冲突 → 已暂存 → 更改 顺序渲染，空组不显示", async () => {
    const { wrapper } = mountSection(FILES);
    const headers = wrapper.findAll("header").map((node) => node.text());
    const conflictAt = headers.findIndex((text) => text.includes("合并冲突"));
    const stagedAt = headers.findIndex((text) => text.includes("已暂存"));
    const changesAt = headers.findIndex((text) => text.includes("更改"));
    expect(conflictAt).toBeGreaterThan(-1);
    expect(stagedAt).toBeGreaterThan(conflictAt);
    expect(changesAt).toBeGreaterThan(stagedAt);

    // 部分暂存文件同时出现在「已暂存」与「更改」
    expect(wrapper.findAll('[aria-label="取消暂存"]')).toHaveLength(2);
    expect(wrapper.findAll('[aria-label="暂存此文件"]')).toHaveLength(3);
    expect(wrapper.findAll('[aria-label="标记为已解决"]')).toHaveLength(1);

    const empty = mountSection([change({ path: "src/working.ts", y: "M" })]);
    expect(empty.wrapper.find('[aria-label="全部标记为解决"]').exists()).toBe(false);
    expect(empty.wrapper.find('[aria-label="全部取消暂存"]').exists()).toBe(false);
  });

  it("行内按钮分别调用 stage / unstage，并按分组决定 diff 侧别", async () => {
    const { wrapper, store } = mountSection(FILES);
    const stage = vi.spyOn(store, "stage").mockResolvedValue({ ok: true });
    const unstage = vi.spyOn(store, "unstage").mockResolvedValue({ ok: true });
    const openFileTab = vi.spyOn(store, "openFileTab");

    // 「更改」组顺序：partly（部分暂存）→ working → fresh
    const stageButtons = wrapper.findAll('[aria-label="暂存此文件"]');
    await stageButtons[0]!.trigger("click");
    expect(stage).toHaveBeenCalledWith(["src/partly.ts"]);
    await stageButtons[1]!.trigger("click");
    expect(stage).toHaveBeenCalledWith(["src/working.ts"]);
    await stageButtons[2]!.trigger("click");
    expect(stage).toHaveBeenCalledWith(["src/fresh.ts"]);

    await wrapper.get('[aria-label="取消暂存"]').trigger("click");
    expect(unstage).toHaveBeenCalledWith(["src/staged.ts"]);

    await wrapper.get('[aria-label="标记为已解决"]').trigger("click");
    expect(stage).toHaveBeenCalledWith(["src/conflict.ts"]);

    const stagedRow = wrapper.findAll("button").find((node) => node.text().includes("staged.ts"));
    await stagedRow?.trigger("click");
    expect(openFileTab).toHaveBeenCalledWith("src/staged.ts", "staged");

    const workingRow = wrapper.findAll("button").find((node) => node.text().includes("working.ts"));
    await workingRow?.trigger("click");
    expect(openFileTab).toHaveBeenCalledWith("src/working.ts", "unstaged");
  });

  it("组头按钮走整组操作：全部暂存 / 全部取消暂存 / 全部标记为解决", async () => {
    const { wrapper, store } = mountSection(FILES);
    const stageAll = vi.spyOn(store, "stageAll").mockResolvedValue({ ok: true });
    const unstageAll = vi.spyOn(store, "unstageAll").mockResolvedValue({ ok: true });
    const resolveConflicts = vi.spyOn(store, "resolveConflicts").mockResolvedValue({ ok: true });

    await wrapper.get('[aria-label="全部暂存"]').trigger("click");
    expect(stageAll).toHaveBeenCalledTimes(1);

    await wrapper.get('[aria-label="全部取消暂存"]').trigger("click");
    expect(unstageAll).toHaveBeenCalledTimes(1);

    await wrapper.get('[aria-label="全部标记为解决"]').trigger("click");
    expect(resolveConflicts).toHaveBeenCalledTimes(1);
  });
});
