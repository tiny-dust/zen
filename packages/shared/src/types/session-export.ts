/**
 * 会话导出格式注册表（渲染层菜单与主进程落盘共用同一份格式清单）：
 * 新增格式 = 这里加一项 + 主进程 session-export 的 renderer 表加一项；
 * 菜单、文件名扩展名、保存筛选器都从这份清单派生，无需改多处。
 */
export type SessionExportFormat = "html" | "md";

export interface SessionExportFormatInfo {
  id: SessionExportFormat;
  /** 默认文件名扩展名（不含点） */
  extension: string;
  /** 语言包键：菜单标签 */
  labelKey: string;
  /** 语言包键：菜单说明（悬浮提示） */
  descriptionKey: string;
}

export const SESSION_EXPORT_FORMATS: readonly SessionExportFormatInfo[] = [
  {
    id: "html",
    extension: "html",
    labelKey: "features.exportHtml",
    descriptionKey: "features.exportHtmlTitle",
  },
  {
    id: "md",
    extension: "md",
    labelKey: "features.exportMd",
    descriptionKey: "features.exportMdTitle",
  },
];

export function isSessionExportFormat(value: unknown): value is SessionExportFormat {
  return SESSION_EXPORT_FORMATS.some((item) => item.id === value);
}
