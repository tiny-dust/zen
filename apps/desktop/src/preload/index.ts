import { contextBridge, webUtils } from "electron";

import { agentApi } from "./agent";
import { appApi } from "./app";
import { authApi } from "./auth";
import { browserApi } from "./browser";
import { cacheApi } from "./cache";
import { errorsApi } from "./errors";
import { externalSessionsApi } from "./external-sessions";
import { featureApi } from "./feature";
import { gitApi } from "./git";
import { imagesApi } from "./images";
import { larkApi } from "./lark";
import { mcpApi } from "./mcp";
import { memoryApi } from "./memory";
import { modelsApi } from "./models";
import { petApi } from "./pet";
import { remoteApi } from "./remote";
import { sessionApi } from "./session";
import { sideChatApi } from "./side-chat";
import { schedulerApi } from "./scheduler";
import { tasksApi } from "./tasks";
import { settingsApi } from "./settings";
import { themeImageApi } from "./theme-image";
import { themePackApi } from "./theme-pack";
import { servicesApi } from "./services";
import { skillsApi } from "./skills";
import { syncApi } from "./sync";
import { systemAbilitiesApi } from "./system-abilities";
import { terminalApi } from "./terminal";
import { updatesApi } from "./updates";
import { workspaceApi } from "./workspace";
import { workflowApi } from "./workflow";

export type { AppInfo } from "./app";

// 装配 window.zen：各 API 域按拆分前 zen 字面量的属性顺序合并，
// 方法实现与 shape 逐字保留，消费方无感知。
const zen = {
  ...appApi,
  ...gitApi,
  ...imagesApi,
  ...authApi,
  ...settingsApi,
  ...themeImageApi,
  ...themePackApi,
  ...updatesApi,
  ...modelsApi,
  ...petApi,
  ...agentApi,
  ...cacheApi,
  ...skillsApi,
  ...mcpApi,
  ...memoryApi,
  ...errorsApi,
  ...externalSessionsApi,
  ...syncApi,
  ...larkApi,
  ...remoteApi,
  ...workspaceApi,
  ...sessionApi,
  ...sideChatApi,
  ...workflowApi,
  pathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
  ...browserApi,
  ...terminalApi,
  ...servicesApi,
  ...schedulerApi,
  ...tasksApi,
  ...featureApi,
  ...systemAbilitiesApi,
};

contextBridge.exposeInMainWorld("zen", zen);

export type ZenApi = typeof zen;
