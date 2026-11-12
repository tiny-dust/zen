import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scans: [] as string[],
  calls: [] as Array<{ command: string; args: string[] }>,
}));

vi.mock("node:child_process", async () => ({
  ...(await vi.importActual<typeof import("node:child_process")>("node:child_process")),
  execFile: Object.assign(() => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: async (command: string, args: string[]) => {
      state.calls.push({ command, args });
      return { stdout: command === "taskkill" ? "" : state.scans.shift() ?? "[]", stderr: "" };
    },
  }),
}));

import { AgentServicesRegistry, parseGroupPids, parseWindowsDescendantPids } from "./agent-services";

const snapshot = (...processes: Array<[number, number]>) =>
  JSON.stringify(processes.map(([ProcessId, ParentProcessId]) => ({ ProcessId, ParentProcessId })));

function track(registry: AgentServicesRegistry) {
  registry.track({ sessionId: "session", command: "pnpm dev", cwd: ".", pid: 100 });
}

afterEach(() => {
  state.scans.length = 0;
  state.calls.length = 0;
  vi.restoreAllMocks();
});

describe("Windows service descendants", () => {
  it("follows parent PID links after shell exit, ignores unrelated processes and validates CIM output", () => {
    expect(parseWindowsDescendantPids(`\uFEFF${snapshot([200, 100], [300, 200], [400, 999])}`, 100))
      .toEqual([200, 300]);
    expect(parseWindowsDescendantPids(snapshot([300, 200], [400, 999]), 100, [200, 300]))
      .toEqual([300]);
    expect(parseWindowsDescendantPids(snapshot([400, 999]), 100, [200, 300])).toEqual([]);
    expect(() => parseWindowsDescendantPids('{"ProcessId":200}', 100)).toThrow("Invalid CIM process list");
    expect(() => parseWindowsDescendantPids('[{"ProcessId":200,"ParentProcessId":"100"}]', 100))
      .toThrow("Invalid CIM process entry");
  });

  it("does not register an idle shell without descendants", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const registry = new AgentServicesRegistry();
    track(registry);
    state.scans.push(snapshot([100, 1], [400, 999]));
    await registry.settle(100);
    expect(await registry.list()).toEqual([]);
    await registry.shutdown();
  });

  it("registers a surviving service, keeps it across refreshes, and removes it after exit", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const registry = new AgentServicesRegistry();
    const broadcast = vi.fn();
    registry.setBroadcast(broadcast);
    track(registry);
    state.scans.push(
      snapshot([200, 100], [300, 200], [400, 999]),
      snapshot([200, 100], [300, 200], [400, 999]),
      snapshot([300, 200], [400, 999]),
      snapshot([400, 999]),
    );
    await registry.settle(100);
    const first = await registry.list();
    expect(first).toHaveLength(1);
    expect(first[0]?.pids).toEqual([200, 300]);
    expect((await registry.list())[0]?.pids).toEqual([300]);
    expect(await registry.list()).toEqual([]);
    expect(broadcast).toHaveBeenLastCalledWith("services:changed", []);
    expect(state.calls.every(({ command }) => command === "powershell.exe")).toBe(true);
    expect(state.calls[0]?.args.join(" ")).toContain("Get-CimInstance Win32_Process");
    await registry.shutdown();
  });

  it("kills living descendants rather than the already-exited shell, including at shutdown", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const registry = new AgentServicesRegistry();
    track(registry);
    state.scans.push(snapshot([200, 100], [300, 200]), snapshot([200, 100], [300, 200]));
    await registry.settle(100);
    const id = (await registry.list())[0]?.id;
    if (!id) throw new Error("expected registered service");
    state.scans.push(snapshot([200, 100], [300, 200]));
    expect(await registry.kill(id)).toEqual({ ok: true });
    expect(state.calls.filter(({ command }) => command === "taskkill").map(({ args }) => args))
      .toEqual([["/PID", "200", "/T", "/F"], ["/PID", "300", "/T", "/F"]]);

    track(registry);
    state.scans.push(snapshot([500, 100]), snapshot([500, 100]));
    await registry.settle(100);
    await registry.shutdown();
    expect(state.calls.filter(({ command }) => command === "taskkill").at(-1)?.args)
      .toEqual(["/PID", "500", "/T", "/F"]);
  });
});

describe("POSIX service process groups", () => {
  it("continues filtering zombies and tracking the detached process group", async () => {
    expect(parseGroupPids("100 100 Z\n200 100 S\n300 999 S\n", 100)).toEqual([200]);
    vi.spyOn(process, "platform", "get").mockReturnValue("linux");
    const registry = new AgentServicesRegistry();
    track(registry);
    state.scans.push("100 100 Z\n200 100 S\n", "200 100 S\n", "");
    await registry.settle(100);
    expect((await registry.list())[0]?.pids).toEqual([200]);
    expect(await registry.list()).toEqual([]);
    expect(state.calls.every(({ command }) => command === "ps")).toBe(true);
    await registry.shutdown();
  });
});
