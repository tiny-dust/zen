/** 会话文件快照（检查点）：Agent 写/改文件前把原文件备份进会话缓存目录的一条记录 */
export interface FileCheckpoint {
  id: string;
  sessionId: string;
  /** 相对工作区根的路径（与备份时刻的 workspace 对应） */
  relativePath: string;
  /** 备份文件绝对路径（会话缓存目录 checkpoints/ 下） */
  backupFile: string;
  createdAt: number;
}
