import type { LocaleModule } from "../index";

/**
 * 会话目标（Goals 目标模式）文案。
 * 键：goal.*（命名空间即文件名 goal）。
 */
export default {
  "zh-CN": {
    set: "设定目标",
    setAria: "设定会话目标",
    pickerTitle: "会话目标",
    textLabel: "目标",
    textPlaceholder: "描述这个会话要达成的目标…",
    budgetLabel: "Token 预算",
    budgetPlaceholder: "如 50000，留空不限",
    budgetUsage: "预算消耗：{used} / {budget}",
    save: "保存",
    pause: "暂停",
    pauseTitle: "暂停目标（不再注入提示词与续跑入口）",
    resume: "继续",
    resumeTitle: "恢复目标为进行中",
    complete: "标记完成",
    completeTitle: "目标已达成",
    clear: "清除",
    clearTitle: "清除会话目标",
    status: {
      active: "进行中",
      paused: "已暂停",
      blocked: "受阻",
      complete: "已完成",
    },
    continue: "继续推进目标",
    continueTitle: "围绕目标继续推进（保留已完成进度，不自动循环）",
  },
  "en-US": {
    set: "Set goal",
    setAria: "Set a session goal",
    pickerTitle: "Session goal",
    textLabel: "Goal",
    textPlaceholder: "Describe what this session should achieve…",
    budgetLabel: "Token budget",
    budgetPlaceholder: "e.g. 50000, empty for no limit",
    budgetUsage: "Budget usage: {used} / {budget}",
    save: "Save",
    pause: "Pause",
    pauseTitle: "Pause the goal (no prompt injection or continue entry)",
    resume: "Resume",
    resumeTitle: "Resume the goal as active",
    complete: "Mark done",
    completeTitle: "The goal has been achieved",
    clear: "Clear",
    clearTitle: "Clear the session goal",
    status: {
      active: "Active",
      paused: "Paused",
      blocked: "Blocked",
      complete: "Done",
    },
    continue: "Continue toward goal",
    continueTitle: "Continue toward the goal (keeps finished progress, no auto-loop)",
  },
} satisfies LocaleModule;
