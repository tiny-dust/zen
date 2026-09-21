/** 提示词展示版本：中 / 英 / 提炼版 */
export type PromptViewVersion = "zh" | "en" | "distilled";

/** 内置系统提示词多版本（设置页与输入框选择器展示） */
export interface PromptPresetVersions {
  /** 完整英文原文（官方公开或泄露整理） */
  en?: string;
  /** 完整中文版（原文行为规则全文中文） */
  zh?: string;
  /** 中文提炼版（运行时默认推荐） */
  distilled?: string;
}

/** 内置系统提示词预设（设置页可选择，agent 运行时注入） */
export interface PromptPreset {
  id: string;
  name: string;
  /** 一句话说明来源与取向 */
  description: string;
  /** 参考来源（调研报告 docs/research/agent-system-prompts.md） */
  origin: string;
  /** full = 提取的完整原文；distilled = 中文提炼版（缺省） */
  kind?: "full" | "distilled";
  /** 运行时注入文本（缺省取 versions.distilled 或 versions.zh/en） */
  text: string;
  /** 展示用多版本；设置页右上角可切换 中/英/提炼版 */
  versions?: PromptPresetVersions;
  /** 预览区默认展示版本 */
  defaultView?: PromptViewVersion;
}
