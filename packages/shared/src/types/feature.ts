/** 可选功能目录（运行时分发）：目录条目由注册表声明，状态由 probe 动态检测 */
export type FeaturePlatform = "darwin" | "win32" | "linux";

/** 目录条目（静态声明部分）：渲染层按 id 走 i18n，name/description 为兜底文案 */
export interface FeatureCatalogEntry {
  id: string;
  /** 兜底显示名（i18n 缺失时使用） */
  name: string;
  /** 兜底描述（i18n 缺失时使用） */
  description: string;
  /** 兜底使用说明（可用时展示「如何使用」；i18n 缺失时使用） */
  usage: string;
  /** 分类键（渲染层映射 i18n 标签，如 input / multimodal / automation） */
  category: string;
  /** 支持的平台列表；空数组表示全平台 */
  platforms: FeaturePlatform[];
  /** 安装状态检查函数键：main 侧 registerFeatureProbe 注册，缺省视为未安装 */
  probeKey: string;
}

/** feature:list 返回的条目：目录声明 + probe 结果 */
export interface FeatureStatus extends FeatureCatalogEntry {
  available: boolean;
  /** 不可用原因（渲染层据此展示灰态与说明）：平台不支持 / 未安装 */
  reason?: "unsupported-platform" | "not-installed";
}

/** feature:list 响应：目录 + 当前平台 probe 结果 */
export interface FeatureCatalogResult {
  ok: boolean;
  platform: FeaturePlatform;
  entries: FeatureStatus[];
}
