/** 当前会话目标的累计用量；新目标开始时从零计数。 */
export interface SessionGoalRuntime {
  goalText: string;
  totalTokens: number;
}
