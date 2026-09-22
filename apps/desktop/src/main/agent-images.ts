import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import type { VisionImage } from "./model-api";
import { completeVisionOnce } from "./model-api";
import { findVisionModel } from "./model-db";

/**
 * agent:run 的附件图片路由：
 * - 当前模型支持视觉 → 图片作为原生多模态 part 直接发给模型；
 * - 不支持视觉 → 用其它已配置的视觉模型做一次性预分析，把文字描述
 *   以 <image-analysis> 块注入提示词，让「不会看图」的模型也能用上图片信息。
 */

const IMAGE_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

/** 单图上限：与文件预览同一量级，避免超大图拖垮请求 */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const IMAGE_ANALYSIS_PROMPT = [
  "请客观、完整地描述这张图片的内容，供另一个无法看图的模型使用。",
  "包含：图片类型（截图/照片/图表/手绘等）、界面或场景结构、关键文字（逐字转写）、",
  "数据与结论。用简体中文，不超过 500 字，不要寒暄。",
].join("");

export function isImagePath(path: string | undefined): boolean {
  if (!path) {
    return false;
  }
  return extname(path).toLowerCase() in IMAGE_MIME;
}

/** 读取附件图片为 base64；过大或不可读的跳过 */
async function loadImageFiles(
  refs: Array<{ name: string; path?: string }>,
): Promise<VisionImage[]> {
  const out: VisionImage[] = [];
  for (const ref of refs) {
    if (!ref.path) {
      continue;
    }
    const mediaType = IMAGE_MIME[extname(ref.path).toLowerCase()];
    if (!mediaType) {
      continue;
    }
    try {
      const buffer = await readFile(ref.path);
      if (buffer.length > MAX_IMAGE_BYTES) {
        continue;
      }
      out.push({
        name: ref.name || ref.path,
        mediaType,
        base64: buffer.toString("base64"),
      });
    } catch {
      // 不可读的附件跳过
    }
  }
  return out;
}

/** 原生多模态路径：转成 data-url part */
export async function loadImageAttachments(
  refs: Array<{ name: string; path?: string }>,
): Promise<Array<{ name: string; dataUrl: string }>> {
  const images = await loadImageFiles(refs);
  return images.map((image) => ({
    name: image.name,
    dataUrl: `data:${image.mediaType};base64,${image.base64}`,
  }));
}

/**
 * 非视觉模型路径：找视觉兜底模型预分析，把描述注入用户消息；
 * 没有兜底模型或分析失败时给出明确说明，不让图片信息静默丢失。
 */
export async function withImageAnalysisText(
  baseText: string,
  refs: Array<{ name: string; path?: string }>,
  current: { providerId: string; modelId: string },
): Promise<string> {
  const suffixNote = (note: string) => `${baseText}\n\n[附件图片] ${note}`;
  const images = await loadImageFiles(refs);
  if (!images.length) {
    return suffixNote("当前模型不支持视觉，且图片无法读取，未能分析。");
  }
  const fallback = await findVisionModel({
    providerId: current.providerId,
    modelId: current.modelId,
  });
  if (!fallback) {
    return suffixNote(
      "当前模型不支持视觉，且未配置具备视觉能力的模型，图片未能分析。可在设置中添加视觉模型后重试。",
    );
  }
  try {
    const description = await completeVisionOnce(images, IMAGE_ANALYSIS_PROMPT, {
      providerId: fallback.providerId,
      modelId: fallback.modelId,
    });
    const names = images.map((image) => `【${image.name}】`).join("、");
    return [
      baseText,
      "",
      "<image-analysis>",
      `以下内容来自视觉模型对用户附件图片的预分析（图片本身对你不可见）：${names}`,
      description,
      "</image-analysis>",
    ].join("\n");
  } catch (error) {
    return suffixNote(
      `视觉分析失败：${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
