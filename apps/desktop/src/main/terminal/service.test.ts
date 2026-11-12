import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scans: [] as Array<(error: Error | null, stdout: string, stderr: string) => void>,
  commands: [] as string[],
  terms: [] as Array<{
    pid: number;
    cols: number;
    rows: number;
    write: ReturnType<typeof vi.fn>;
    kill: ReturnType<typeof vi.fn>;
    exit?: (event: { exitCode: number }) => void;
  }>,
}));

vi.mock("node:child_process", async () => ({
  ...(await vi.importActual<typeof import("node:child_process")>("node:child_process")),
  execFile: Object.assign(() => {}, {
    [Symbol.for("nodejs.util.promisify.custom")]: (command: string) => new Promise<{ stdout: string; stderr: string }>((resolve) => {
      state.commands.push(command);
      state.scans.push((_error, stdout, stderr) => resolve({ stdout, stderr }));
    }),
  }),
}));
vi.mock("@lydell/node-pty", () => ({
  spawn: () => {
    const term = {
      pid: 100 + state.terms.length,
      cols: 80,
      rows: 24,
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: vi.fn(),
      onExit(callback: (event: { exitCode: number }) => void) { term.exit = callback; },
      exit: undefined as ((event: { exitCode: number }) => void) | undefined,
    };
    state.terms.push(term);
    return term;
  },
}));
vi.mock("@zen/tools-terminal", () => ({
  resolveDefaultShell: () => ({ path: "/bin/sh", args: [], label: "sh", source: "fallback" }),
}));

import { findLiveDescendant, parsePosixProcesses, parseWindowsProcesses, TerminalService } from "./service";

const shell = " 100 1 Ss /bin/sh\n";
const child = " 200 100 S /usr/bin/sh\n 201 200 S /usr/bin/sleep\n";
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
async function completeScan(output: string) {
  const callback = state.scans.shift();
  if (!callback) throw new Error("expected process scan");
  callback(null, output, "");
  await flush();
}

beforeEach(() => {
  vi.useFakeTimers();
  state.scans.length = 0;
  state.commands.length = 0;
  state.terms.length = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("PTY descendant detection", () => {
  it("distinguishes an idle shell, unrelated processes, zombies and a live grandchild", () => {
    const base = parsePosixProcesses(`${shell} 101 1 S unrelated\n 102 101 S other\n`);
    expect(findLiveDescendant(100, base)).toBeUndefined();
    expect(findLiveDescendant(100, parsePosixProcesses(`${shell} 201 100 Z defunct\n`))).toBeUndefined();
    expect(findLiveDescendant(100, parsePosixProcesses(`${shell}${child}`))).toMatchObject({ pid: 201, command: "/usr/bin/sleep" });
    expect(findLiveDescendant(100, parsePosixProcesses(child))).toBeUndefined();
  });

  it("parses Windows CIM PID/parent/name entries and rejects invalid snapshots", () => {
    expect(findLiveDescendant(100, parseWindowsProcesses('\uFEFF[{"ProcessId":100,"ParentProcessId":1,"Name":"pwsh.exe"},{"ProcessId":200,"ParentProcessId":100,"Name":"node.exe"}]')))
      .toMatchObject({ pid: 200, command: "node.exe" });
    expect(() => parseWindowsProcesses('{"ProcessId":100}')).toThrow("Invalid CIM process list");
  });
});

describe("TerminalService activity lifecycle", () => {
  it("starts idle, follows surviving background descendants, updates owner on submission and clears on completion/kill", async () => {
    const service = new TerminalService();
    const listener = vi.fn();
    service.onActivity(listener);
    const result = service.create({ ownerSessionId: "chat-a" });
    const id = result.session!.id;
    expect(service.listActivities()).toEqual([{ terminalId: id, ownerSessionId: "chat-a", active: false }]);
    await completeScan(shell);
    expect(listener).not.toHaveBeenCalled();

    service.write(id, "sleep 30", "chat-b");
    expect(service.listActivities()[0]?.ownerSessionId).toBe("chat-a");
    service.write(id, "\r", "chat-b");
    expect(service.listActivities()[0]?.ownerSessionId).toBe("chat-b");
    vi.advanceTimersByTime(1500);
    await completeScan(`${shell}${child}`);
    expect(service.listActivities()[0]).toMatchObject({ active: true, ownerSessionId: "chat-b", command: "/usr/bin/sleep" });
    service.write(id, "\r", "chat-c");
    expect(service.listActivities()[0]?.ownerSessionId).toBe("chat-b");

    vi.advanceTimersByTime(1500);
    await completeScan(`${shell} 201 100 S /usr/bin/sleep\n`);
    expect(service.listActivities()[0]?.active).toBe(true);
    vi.advanceTimersByTime(1500);
    await completeScan(shell);
    expect(service.listActivities()[0]).toMatchObject({ active: false, ownerSessionId: "chat-b" });
    service.kill(id);
    expect(listener).toHaveBeenLastCalledWith({ terminalId: id, ownerSessionId: "chat-b", active: false });
    expect(service.listActivities()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cleans up on shell exit and ignores a late scan after close", async () => {
    const service = new TerminalService();
    const listener = vi.fn();
    service.onActivity(listener);
    const id = service.create().session!.id;
    state.terms[0]!.exit?.({ exitCode: 0 });
    expect(listener).toHaveBeenCalledWith({ terminalId: id, ownerSessionId: null, active: false });
    expect(service.listActivities()).toEqual([]);
    await completeScan(`${shell}${child}`);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses PowerShell/CIM on Windows and does not mark an idle PTY as active", async () => {
    vi.spyOn(process, "platform", "get").mockReturnValue("win32");
    const service = new TerminalService();
    const id = service.create().session!.id;
    expect(state.commands).toEqual(["powershell.exe"]);
    await completeScan('[{"ProcessId":100,"ParentProcessId":1,"Name":"pwsh.exe"}]');
    expect(service.listActivities()[0]).toMatchObject({ terminalId: id, active: false });
    service.killAll();
  });
});
