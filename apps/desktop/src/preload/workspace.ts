import { ipcRenderer } from "electron";

import type {
  DirEntry,
  FilePreview,
  ReadFileResult,
  Workspace,
  WorkspaceFile,
  WorkspaceGroup,
} from "@zen/shared";

export const workspaceApi = {
  workspace: {
    listFiles(cwd?: string): Promise<WorkspaceFile[]> {
      return ipcRenderer.invoke("workspace:list-files", cwd);
    },
    readDir(cwd: string | undefined, relPath: string): Promise<DirEntry[] | null> {
      return ipcRenderer.invoke("workspace:read-dir", cwd, relPath);
    },
    readFile(
      cwd: string | undefined,
      relPath: string,
    ): Promise<ReadFileResult | null> {
      return ipcRenderer.invoke("workspace:read-file", cwd, relPath);
    },
    /** 文件预览：图片 data URL / 文本截断 / 二进制 unsupported；path 可为绝对路径 */
    previewFile(cwd: string | undefined, path: string): Promise<FilePreview | null> {
      return ipcRenderer.invoke("workspace:preview-file", cwd, path);
    },
    writeFile(
      cwd: string | undefined,
      relPath: string,
      content: string,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("workspace:write-file", cwd, relPath, content);
    },
    list(): Promise<WorkspaceGroup[]> {
      return ipcRenderer.invoke("workspace:list");
    },
    create(): Promise<Workspace | null> {
      return ipcRenderer.invoke("workspace:create");
    },
    pin(id: string, pinned: boolean): Promise<WorkspaceGroup[]> {
      return ipcRenderer.invoke("workspace:pin", id, pinned);
    },
    archive(id: string, archived: boolean): Promise<WorkspaceGroup[]> {
      return ipcRenderer.invoke("workspace:archive", id, archived);
    },
    rename(id: string, name: string): Promise<WorkspaceGroup[]> {
      return ipcRenderer.invoke("workspace:rename", id, name);
    },
    remove(id: string): Promise<WorkspaceGroup[]> {
      return ipcRenderer.invoke("workspace:delete", id);
    },
  },
};
