import type { LocaleModule } from "../index";

export default {
  "zh-CN": {
    title: "会话工作树",
    active: "独立运行",
    description: "为当前会话创建独立的 Git 工作目录，便于与同项目的其他会话并行。",
    create: "创建工作树",
    createFailed: "创建工作树失败",
    remove: "移除工作树",
    removeFailed: "移除工作树失败",
    removeTitle: "移除当前会话的工作树？",
    removeDescription: "未提交改动会阻止移除；已有提交的分支会保留，之后可手动切换或合并。",
  },
  "en-US": {
    title: "Session worktree",
    active: "Isolated",
    description: "Give this chat an isolated Git checkout so other chats can work on the same project in parallel.",
    create: "Create worktree",
    createFailed: "Could not create worktree",
    remove: "Remove worktree",
    removeFailed: "Could not remove worktree",
    removeTitle: "Remove this chat's worktree?",
    removeDescription: "Uncommitted changes prevent removal. The branch and its commits remain available to check out or merge later.",
  },
} satisfies LocaleModule;
