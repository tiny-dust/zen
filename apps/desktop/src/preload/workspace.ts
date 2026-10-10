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
    /** 重命名文件/目录（同目录改名；目标已存在报错）。区别于工作区分组的 rename。 */
    renameEntry(
      cwd: string | undefined,
      relPath: string,
      newName: string,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("workspace:rename-entry", cwd, relPath, newName);
    },
    /** 删除到系统废纸篓（跨平台 shell.trashItem） */
    trash(cwd: string | undefined, relPath: string): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("workspace:trash", cwd, relPath);
    },
    /** 递归复制到目标目录；同目录粘贴自动生成「name 副本」 */
    copy(
      cwd: string | undefined,
      srcRel: string,
      destDirRel: string,
    ): Promise<{ ok: boolean; error?: string }> {
      return ipcRenderer.invoke("workspace:copy", cwd, srcRel, destDirRel);
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
