/** 会话文件快照（检查点）：Agent 写/改文件前把原文件备份进会话缓存目录的一条记录 */
export interface FileCheckpoint {
  id: string;
  sessionId: string;
  /** 相对工作区根的路径（与备份时刻的 workspace 对应） */
  relativePath: string;
  /**
   * 改前备份文件绝对路径（会话缓存目录 checkpoints/ 下）。
   * 该轮新建的文件没有改前内容，此时缺省（撤销时按新建文件移除）。
   */
  backupFile?: string;
  /** 归属轮次（run 序号，从 1 起）；旧记录缺省视为第 1 轮 */
  run?: number;
  createdAt: number;
  /** 改后副本绝对路径（撤销后重新套用用）；旧记录/副本失败时缺省 */
  afterFile?: string;
}

/** 按轮（run）分组的文件改动摘要：「文件快照」区每组一行展示 */
export interface TurnCheckpointGroup {
  /** 轮次序号（从 1 起） */
  run: number;
  /** 该轮首个改动的时间（turn 标记时刻） */
  createdAt: number;
  /** 该轮改动过的文件数（同文件多次写算一个） */
  fileCount: number;
  /** 是否处于已撤销状态（已撤销的轮次可重新套用） */
  undone: boolean;
}
