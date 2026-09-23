import { createPinia, disposePinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUserStore } from "@/stores/user";
import { useWorkspaceStore } from "@/stores/workspace";

let pinia: ReturnType<typeof createPinia>;

beforeEach(() => {
  localStorage.clear();
  pinia = createPinia();
  setActivePinia(pinia);
});

afterEach(() => {
  disposePinia(pinia);
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("user bootstrap", () => {
  it("waits for auth state before the initial workspace refresh", async () => {
    let resolveAuth: ((state: { loggedIn: boolean; user: { login: string } }) => void) | undefined;
    const authState = new Promise<{ loggedIn: boolean; user: { login: string } }>((resolve) => {
      resolveAuth = resolve;
    });
    const list = vi.fn().mockResolvedValue([]);

    vi.stubGlobal("zen", {
      auth: {
        state: vi.fn(() => authState),
        refreshProfile: vi.fn().mockResolvedValue({ loggedIn: true, user: { login: "octocat" } }),
        onChanged: vi.fn(() => () => undefined),
        onDeviceCode: vi.fn(() => () => undefined),
      },
      workspace: { list },
    });

    const user = useUserStore();
    const workspace = useWorkspaceStore();
    user.bootstrap();
    const refresh = user.waitForReady().then(() => workspace.refresh());

    await Promise.resolve();
    expect(list).not.toHaveBeenCalled();

    resolveAuth?.({ loggedIn: true, user: { login: "octocat" } });
    await refresh;

    expect(list).toHaveBeenCalledTimes(1);
  });
});
