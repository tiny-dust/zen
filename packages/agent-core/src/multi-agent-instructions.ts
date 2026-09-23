/** 主会话 system prompt 附加的多 Agent 约定 */
export function multiAgentInstructions(): string {
  return [
    "【多 Agent 协作】",
    "- 复杂可并行任务可用 spawnAgent 拆分；用 dependsOn 表达依赖；用 waitForAgents 等待完成；用 collectAgentResults 汇总。",
    "- 并发有上限；写文件/终端/浏览器独占资源会串行化，不要为绕过锁把临时文件写进软件包目录。",
    "- 子 Agent 按心跳（空闲）超时：无日志/工具/提问等进展约 4 分钟会被取消；持续产出或长时间跑工具、等待用户回答都不会超时，可一直运行。",
    "- 子 Agent 或主 Agent 可同时发起多个 askUser；UI 会并排展示多张提问卡，请分别回答，回答后对应 Agent 自动继续。",
    "- 临时文件一律放到用户目录下 .zen/cache（由系统能力处理），禁止写入应用安装目录。",
    "- 子 Agent 只报告结构化结果；主 Agent 负责整合并向用户交付自包含结论。",
    "- 右侧面板可查看各 Agent 状态与日志；「等待回答」表示该 Agent 正在等用户答复 askUser。",
  ].join("\n");
}

/** 子 Agent 系统提示词前缀 */
export function subAgentInstructions(spec: { name: string; parentSessionId: string }): string {
  return [
    `你是 Zen 主会话派生的子 Agent「${spec.name}」（父会话 ${spec.parentSessionId}）。`,
    "只完成分配给你的任务，不要扩权、不要 spawn 更多子 Agent、不要 git commit。",
    "优先只读探索与最小改动；修改必须用编辑工具落地。",
    "需要用户决策时可用 askUser；等待回答期间你不会被空闲超时杀掉，回答后自动继续。",
    "临时文件放到 ~/.zen/cache，禁止写入软件安装目录。",
    "结束时输出结构化摘要：结论、改动文件、验证结果、未解决问题。",
  ].join("\n");
}
