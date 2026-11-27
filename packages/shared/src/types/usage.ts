/** 用量账本筛选：days 为最近 N 天（含今天），0/缺省表示全部历史 */
export interface UsageLedgerFilter {
  days?: number;
  providerId?: string;
  modelId?: string;
}

export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  /** 计入的 finish-step 次数（不是请求数：一次请求可多步） */
  events: number;
}

/** 按 供应商 + 模型 汇总 */
export interface UsageLedgerModel extends UsageTotals {
  providerId: string;
  modelId: string;
}

/** 按会话汇总；sessionId 为空串表示该记录没有归属会话（历史数据/后台任务） */
export interface UsageLedgerSession extends UsageTotals {
  sessionId: string;
}

/** 账本明细条目（按时间倒序，主进程限量返回） */
export interface UsageLedgerEvent {
  ts: number;
  providerId: string;
  modelId: string;
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
}

export interface UsageLedger {
  /** 实际统计的窗口天数（0 = 全部历史） */
  days: number;
  /**
   * 费用：仓库内没有模型价格数据，因此恒为 null。
   * 估算费用与供应商真实扣费必须分开呈现，不用估算值冒充扣费。
   */
  estimatedCost: null;
  totals: UsageTotals;
  byModel: UsageLedgerModel[];
  bySession: UsageLedgerSession[];
  recent: UsageLedgerEvent[];
}
