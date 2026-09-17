/** 内置系统提示词预设（设置页可选择，agent 运行时注入） */
export interface PromptPreset {
  id: string;
  name: string;
  /** 一句话说明来源与取向 */
  description: string;
  /** 参考来源（调研报告 docs/research/agent-system-prompts.md） */
  origin: string;
  text: string;
}
