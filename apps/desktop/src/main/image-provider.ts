import { nativeImage } from "electron";

import type { ProviderModel, ProviderSummary } from "@zen/shared";

import { listProviders, loadProviderApiKey, normalizeBaseUrl } from "./model-db";

/**
 * 图片能力（生成 / 编辑）共用的供应商解析与图片校验：
 * 认证方式、协议、模型启用状态、imageEdit 能力开关只在这里判一次，
 * 调用方（宠物精灵、素材库生图）拿到的 target 已全部通过校验。
 */

export interface ImageModelTarget {
  provider: ProviderSummary;
  model: ProviderModel;
  apiKey: string;
  /** 已去掉尾斜杠的 Base URL */
  baseUrl: string;
}

const PNG_SIGNATURE = Buffer.from("89504e470d0a1a0a", "hex");
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);

export function decodeBase64(value: string, maxBytes: number, label: string): Buffer {
  if (Math.floor(value.length * 3 / 4) - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0) > maxBytes) {
    throw new Error(`${label}不能超过 ${maxBytes / 1024 / 1024} MB`);
  }
  if (!value || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new Error(`${label}的 Base64 数据无效`);
  }
  const data = Buffer.from(value, "base64");
  if (data.length > maxBytes) throw new Error(`${label}不能超过 ${maxBytes / 1024 / 1024} MB`);
  return data;
}

/** 按文件头判断图片格式；未知格式返回 null（不做扩展名猜测） */
export function sniffImageMime(buffer: Buffer): "image/png" | "image/jpeg" | "image/webp" | null {
  if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) return "image/png";
  if (buffer.subarray(0, JPEG_SIGNATURE.length).equals(JPEG_SIGNATURE)) return "image/jpeg";
  if (buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** 读响应体并限长：超限先中断，不把超大响应读进内存 */
export async function readLimitedJson(response: Response, limit: number, label: string): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`${label}供应商响应为空`);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) throw new Error(`${label}供应商响应过大`);
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

/** 供应商错误体 → 可展示的短消息（去掉可能回显的 API Key） */
export async function providerErrorMessage(
  response: Response,
  apiKey: string,
  limit: number,
  label: string,
): Promise<string> {
  let message = `HTTP ${response.status}`;
  try {
    const payload = await readLimitedJson(response, limit, label);
    const error = payload as { error?: { message?: unknown } | string; message?: unknown } | null;
    const detail = typeof error?.error === "string" ? error.error : error?.error?.message ?? error?.message;
    if (typeof detail === "string" && detail.trim()) message = detail;
  } catch {
    // 非 JSON 错误响应仍保留 HTTP 状态
  }
  return `${label}供应商错误：${message.split(apiKey).join("[REDACTED]")}`;
}

/** 校验图片二进制可解码并返回尺寸 */
export function imageSize(buffer: Buffer): { width: number; height: number } {
  const image = nativeImage.createFromBuffer(buffer);
  const { width, height } = image.getSize();
  if (image.isEmpty() || width < 1 || height < 1) {
    throw new Error("供应商返回的图片无法解码");
  }
  return { width, height };
}

/**
 * 解析并校验图片模型：label 用于错误文案（「图片编辑」/「图片生成」）。
 * 不把密钥写进错误消息。
 */
export async function resolveImageModel(
  providerId: string,
  modelId: string,
  label: string,
): Promise<ImageModelTarget> {
  const provider = (await listProviders()).find((item) => item.id === providerId);
  if (!provider?.enabled) throw new Error(`${label}供应商不存在或未启用`);
  if ((provider.authMode ?? "api-key") !== "api-key" || !provider.hasApiKey) {
    throw new Error(`${label}供应商需要 API Key 认证`);
  }
  if (provider.protocol !== "openai-chat" && provider.protocol !== "openai-responses") {
    throw new Error(`${label}仅支持 OpenAI 协议`);
  }
  const model = provider.models.find((item) => item.id === modelId);
  if (!model?.enabled) throw new Error(`${label}模型不存在或未启用`);
  if (model.capabilities?.imageEdit !== true) throw new Error(`模型不支持${label}`);

  const apiKey = await loadProviderApiKey(provider.id);
  const baseUrl = normalizeBaseUrl(provider.baseUrl);
  if (!baseUrl) throw new Error(`${label}供应商未配置 Base URL`);
  return { provider, model, apiKey, baseUrl };
}

/** Base URL → 具体图片端点（已是 /v1 结尾的不重复拼接） */
export function imageEndpoint(baseUrl: string, path: "generations" | "edits"): string {
  return `${baseUrl}${/\/v\d+$/.test(baseUrl) ? "" : "/v1"}/images/${path}`;
}
