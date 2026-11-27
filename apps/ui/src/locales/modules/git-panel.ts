import type { LocaleModule } from "../index";

/**
 * Git 面板 Source Control 文案（提交框 / 已暂存·更改·冲突分组 / 暂存操作 / diff 侧别徽标）。
 * 键：git-panel.gitPanel.*（命名空间即文件名 git-panel）；未改动部分继续复用 panels.*。
 */
export default {
  "zh-CN": {
    gitPanel: {
      commitPlaceholder: "消息（⌘Enter 提交已暂存）",
      commit: "提交",
      commitAndPush: "提交并推送",
      generateMessage: "用 AI 生成提交信息",
      nothingStagedHint: "先暂存要提交的变更",
      conflictsGroup: "合并冲突",
      stagedGroup: "已暂存",
      changesGroup: "更改",
      stageFile: "暂存此文件",
      unstageFile: "取消暂存",
      resolveFile: "标记为已解决",
      stageAll: "全部暂存",
      unstageAll: "全部取消暂存",
      resolveAll: "全部标记为解决",
      nothingToStage: "没有可暂存的文件",
      nothingToUnstage: "没有可取消暂存的文件",
      stageFailed: "暂存失败",
      unstageFailed: "取消暂存失败",
      stagedBadge: "已暂存",
      unstagedBadge: "未暂存",
    },
  },
  "en-US": {
    gitPanel: {
      commitPlaceholder: "Message (⌘Enter commits staged changes)",
      commit: "Commit",
      commitAndPush: "Commit & Push",
      generateMessage: "Generate commit message with AI",
      nothingStagedHint: "Stage changes before committing",
      conflictsGroup: "Merge Conflicts",
      stagedGroup: "Staged Changes",
      changesGroup: "Changes",
      stageFile: "Stage this file",
      unstageFile: "Unstage",
      resolveFile: "Mark as resolved",
      stageAll: "Stage all",
      unstageAll: "Unstage all",
      resolveAll: "Mark all as resolved",
      nothingToStage: "No files to stage",
      nothingToUnstage: "No files to unstage",
      stageFailed: "Failed to stage",
      unstageFailed: "Failed to unstage",
      stagedBadge: "Staged",
      unstagedBadge: "Unstaged",
    },
  },
} satisfies LocaleModule;
