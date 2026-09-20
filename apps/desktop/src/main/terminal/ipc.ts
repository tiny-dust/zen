import { ipcMain } from "electron";

import type {
  PtyDataEvent,
  PtyExitEvent,
  TerminalCreateResult,
  TerminalSessionInfo,
  TerminalShellInfo,
} from "@zen/shared";
import { getTerminalService } from "./service";

export function registerTerminalIpc(
  broadcast: (channel: string, payload: unknown) => void,
): void {
  const service = getTerminalService();

  service.onData((event: PtyDataEvent) => {
    broadcast("pty:data", event);
  });
  service.onExit((event: PtyExitEvent) => {
    broadcast("pty:exit", event);
  });

  ipcMain.handle("terminal:shell", (): TerminalShellInfo => service.defaultShell());

  ipcMain.handle("terminal:list", (): TerminalSessionInfo[] => service.list());

  ipcMain.handle(
    "terminal:create",
    async (
      _event,
      options?: { cwd?: string; cols?: number; rows?: number; shell?: string },
    ): Promise<TerminalCreateResult> => {
      return service.create(options);
    },
  );

  ipcMain.handle("terminal:write", async (_event, sessionId: string, data: string) => {
    return { ok: service.write(sessionId, data) };
  });

  ipcMain.handle(
    "terminal:resize",
    async (_event, sessionId: string, cols: number, rows: number) => {
      return { ok: service.resize(sessionId, cols, rows) };
    },
  );

  ipcMain.handle("terminal:kill", async (_event, sessionId: string) => {
    return { ok: service.kill(sessionId) };
  });

  ipcMain.handle("terminal:open-external", async (_event, cwd?: string) => {
    return service.openExternal(cwd || process.cwd());
  });
}
