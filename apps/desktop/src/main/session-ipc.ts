import { dialog, ipcMain } from "electron";

import {
  createSession,
  createWorkspace,
  deleteWorkspace,
  getSession,
  listWorkspaceGroups,
  renameSession,
  setWorkspaceArchived,
} from "./workspace-db";

export function registerSessionIpc(): void {
  ipcMain.handle("workspace:list", () => listWorkspaceGroups());

  ipcMain.handle("workspace:create", async () => {
    const result = await dialog.showOpenDialog({
      title: "选择工作区目录",
      properties: ["openDirectory", "createDirectory"],
    });
    const dir = result.filePaths[0];
    if (!dir || result.canceled) {
      return null;
    }
    return createWorkspace(dir);
  });

  ipcMain.handle("workspace:archive", (_event, id: string, archived: boolean) => {
    setWorkspaceArchived(id, archived === true);
    return listWorkspaceGroups();
  });

  ipcMain.handle("workspace:delete", (_event, id: string) => {
    deleteWorkspace(id);
    return listWorkspaceGroups();
  });

  ipcMain.handle("session:create", (_event, workspaceId: string | null) =>
    createSession(workspaceId),
  );

  ipcMain.handle("session:open", (_event, id: string) => getSession(id) ?? null);

  ipcMain.handle("session:rename", (_event, id: string, title: string) => {
    if (typeof title === "string" && title.trim()) {
      renameSession(id, title.trim());
    }
  });
}
