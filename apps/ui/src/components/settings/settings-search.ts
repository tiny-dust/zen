/**
 * 设置项搜索索引：让设置页搜索框匹配到具体配置小节（而不只是导航标签），
 * 命中后跳转对应 tab 并滚动到锚点（各小节组件/面板上的 section id）。
 */

import type { SettingsTab } from "@/stores/settings";

export interface SettingsIndexEntry {
  /** 命中后要切换到的设置页 tab */
  tab: SettingsTab;
  /** 小节锚点（面板内 section id）；空表示整页命中，只切 tab */
  sectionId?: string;
  /** 标题文案的 i18n key */
  titleKey: string;
  /** 描述文案的 i18n key（参与匹配与展示） */
  descKey?: string;
  /** 额外匹配词（中英混排，含常用同义词；不含 UI 上不出现的内容） */
  keywords?: string[];
}

export const SETTINGS_INDEX: SettingsIndexEntry[] = [
  // 通用
  {
    tab: "general",
    sectionId: "set-general-update",
    titleKey: "settings.update.title",
    keywords: ["update upgrade version feed 更新 升级 版本 检查更新"],
  },
  {
    tab: "general",
    sectionId: "set-general-cache",
    titleKey: "settings.cache.title",
    descKey: "settings.cache.description",
    keywords: ["cache clear cleanup temporary favicon 缓存 清理 图标"],
  },
  // 外观
  {
    tab: "appearance",
    sectionId: "set-general-appearance",
    titleKey: "settings.general.appearance",
    keywords: ["theme appearance dark light 主题 外观 深色 浅色", "language locale 语言 中文 english"],
  },
  {
    tab: "appearance",
    sectionId: "set-general-code-theme",
    titleKey: "settings.codeTheme.title",
    keywords: ["code theme highlight shiki 代码主题 高亮"],
  },
  // 快捷键
  {
    tab: "shortcuts",
    titleKey: "settings.nav.shortcuts",
    keywords: ["shortcut keybinding hotkey 快捷键 键盘 改键 global 全局"],
  },
  // 权限
  {
    tab: "permissions",
    sectionId: "set-agent-permission",
    titleKey: "settings.agent.permissionTitle",
    descKey: "settings.agent.permissionDesc",
    keywords: ["permission approval mode 权限 审批 确认 放行 full access 完全访问"],
  },
  {
    tab: "permissions",
    sectionId: "set-agent-approval",
    titleKey: "settings.agent.approvalTitle",
    descKey: "settings.agent.approvalDesc",
    keywords: [
      "command rule prefix auto approve allow ask 命令 规则 前缀 自动放行 白名单 帮我核准 助手 审查",
    ],
  },
  {
    tab: "permissions",
    sectionId: "set-agent-sandbox",
    titleKey: "settings.agent.sandboxTitle",
    keywords: ["sandbox isolate worktree 隔离区 沙箱 副本 rebuild 重建"],
  },
  {
    tab: "permissions",
    sectionId: "set-agent-cua",
    titleKey: "settings.agent.cuaTitle",
    keywords: ["cua desktop automation mouse keyboard accessibility 桌面自动化 鼠标 键盘 辅助功能 屏幕操作"],
  },
  // Agent 能力
  {
    tab: "agent",
    sectionId: "set-agent-websearch",
    titleKey: "settings.agent.webSearchTitle",
    keywords: ["web search tavily bocha serper 搜索 联网 api key"],
  },
  {
    tab: "agent",
    sectionId: "set-agent-memory",
    titleKey: "settings.agent.memoryTitle",
    keywords: ["memory notes habits snapshot 记忆 备注 习惯 设备环境 快照"],
  },
  // 飞书
  {
    tab: "lark",
    sectionId: "set-lark-bridge",
    titleKey: "settings.lark.bridgeTitle",
    keywords: ["lark feishu bridge gateway cli 飞书 桥接 网关 quick command 快捷命令"],
  },
  // 提示词
  {
    tab: "prompts",
    titleKey: "settings.prompts.title",
    keywords: ["system prompt preset 提示词 系统提示词 自定义 custom distilled 提炼版"],
  },
  // 个人资料
  {
    tab: "profile",
    titleKey: "settings.nav.profile",
    keywords: ["profile account github login sync 资料 账号 登录 云同步 identity 身份"],
  },
  // 模型
  {
    tab: "models",
    titleKey: "settings.nav.models",
    keywords: ["model provider api key base url 模型 供应商 添加模型 上下文 推理"],
  },
];

/** 匹配：标题/描述/关键词中包含查询串（大小写不敏感）即命中 */
export function searchSettings(
  query: string,
  translate: (key: string) => string,
): Array<SettingsIndexEntry & { title: string; desc: string }> {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }
  return SETTINGS_INDEX.flatMap((entry) => {
    const title = translate(entry.titleKey);
    const desc = entry.descKey ? translate(entry.descKey) : "";
    const haystack = [title, desc, ...(entry.keywords ?? [])].join(" ").toLowerCase();
    if (!haystack.includes(q)) {
      return [];
    }
    return [{ ...entry, title, desc }];
  });
}
