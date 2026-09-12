---
name: commit-helper
description: 根据当前 git diff 生成规范 commit message 并提交。适用于用户要求「提交代码」「commit」「写 commit message」。
triggers:
  - 提交代码
  - commit
  - commit message
---

# Commit Helper

1. 运行 `git status` 与 `git diff`（含 staged 与 unstaged）。
2. 阅读最近 10 条 commit message，匹配仓库风格。
3. 起草 1–2 句英文 commit message，侧重「为什么」而不是罗列文件。
4. 仅在用户明确要求时执行 `git add` / `git commit`。
