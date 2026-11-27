/** 生图尺寸：与 OpenAI images 端点一致的三种方形/竖横版 */
export const IMAGE_SIZES = ["1024x1024", "1024x1536", "1536x1024"] as const;

export type ImageSize = (typeof IMAGE_SIZES)[number];

export interface ImageGenerateInput {
  providerId: string;
  modelId: string;
  prompt: string;
  size?: ImageSize;
}

/** 素材库里的一条生图记录（文件与 JSON 元数据同名存放于 ~/.zen/images） */
export interface GeneratedImageRecord {
  id: string;
  prompt: string;
  providerId: string;
  modelId: string;
  width: number;
  height: number;
  sizeBytes: number;
  createdAt: number;
  /** 图片文件绝对路径：可直接作为会话附件引用 */
  path: string;
  fileName: string;
}

/** 生图结果：成功记录或明确错误（错误文案已脱敏） */
export interface ImageGenerateResult {
  ok: boolean;
  record?: GeneratedImageRecord;
  error?: string;
}
