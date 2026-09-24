import { contextBridge, webUtils } from "electron";

import { agentApi } from "./agent";
import { appApi } from "./app";
import { authApi } from "./auth";
import { browserApi } from "./browser";
import { cacheApi } from "./cache";
import { gitApi } from "./git";
import { larkApi } from "./lark";
import { mcpApi } from "./mcp";
import { memoryApi } from "./memory";
import { modelsApi } from "./models";
import { sessionApi } from "./session";
import { settingsApi } from "./settings";
import { servicesApi } from "./services";
import { skillsApi } from "./skills";
import { syncApi } from "./sync";
import { terminalApi } from "./terminal";
import { updatesApi } from "./updates";
import { workspaceApi } from "./workspace";

export type { AppInfo } from "./app";

// 装配 window.zen：各 API 域按拆分前 zen 字面量的属性顺序合并，
// 方法实现与 shape 逐字保留，消费方无感知。
const zen = {
  ...appApi,
  ...gitApi,
  ...authApi,
  ...settingsApi,
  ...updatesApi,
  ...modelsApi,
  ...agentApi,
  ...cacheApi,
  ...skillsApi,
  ...mcpApi,
  ...memoryApi,
  ...syncApi,
  ...larkApi,
  ...workspaceApi,
  ...sessionApi,
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
  ...browserApi,
  ...terminalApi,
  ...servicesApi,
};

contextBridge.exposeInMainWorld("zen", zen);

export type ZenApi = typeof zen;
