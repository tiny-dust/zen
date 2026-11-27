import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { GeneratedImageRecord, ImageGenerateInput, ImageGenerateResult, ImageSize } from "@zen/shared";
import { IMAGE_SIZES } from "@zen/shared";

import {
  decodeBase64,
  imageEndpoint,
  imageSize,
  providerErrorMessage,
  readLimitedJson,
  resolveImageModel,
  sniffImageMime,
} from "./image-provider";
import { zenImagesDir } from "./zen-dir";

/**
 * 生图 + 素材库（本地文件即数据源）：
 * - 生成走用户已配置、开启 imageEdit 能力的 API Key 模型，结果落到 ~/.zen/images；
 * - 每张图一个图片文件 + 同名 .json 元数据（不维护索引文件，损坏单条不影响整体）；
 * - 记录里带绝对路径，可直接作为会话附件复用。
 */

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** 响应体上限：base64 膨胀 4/3 再加余量 */
const RESPONSE_LIMIT = Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 1024 * 1024;
const MAX_PROMPT = 2000;
const MAX_LIST = 200;
const ID_PATTERN = /^img-[a-z0-9]+-[0-9a-f]{8}$/;
const EXTENSIONS = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

/** 当前生成请求的中止句柄（用户点「取消」时用） */
let controller: AbortController | null = null;

export function cancelImageGeneration(): { ok: boolean } {
  controller?.abort();
  controller = null;
  return { ok: true };
}

function recordPath(id: string): string {
  return join(zenImagesDir(), `${id}.json`);
}

function parseRecord(raw: string): GeneratedImageRecord | null {
  try {
    const value = JSON.parse(raw) as Partial<GeneratedImageRecord> | null;
    if (!value || typeof value !== "object") return null;
    const { id, prompt, providerId, modelId, width, height, sizeBytes, createdAt, path, fileName } = value;
    if (typeof id !== "string" || !ID_PATTERN.test(id)) return null;
    if (typeof prompt !== "string" || typeof providerId !== "string" || typeof modelId !== "string") return null;
    if (typeof fileName !== "string" || fileName.includes("/") || fileName.includes("\\")) return null;
    if (typeof path !== "string" || typeof createdAt !== "number") return null;
    if (typeof width !== "number" || typeof height !== "number" || typeof sizeBytes !== "number") return null;
    return { id, prompt, providerId, modelId, width, height, sizeBytes, createdAt, path, fileName };
  } catch {
    return null;
  }
}

/** 素材库清单：元数据解析失败的条目直接跳过（不猜、不补），按生成时间倒序 */
export async function listImages(): Promise<GeneratedImageRecord[]> {
  const dir = zenImagesDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const records: GeneratedImageRecord[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const raw = await readFile(join(dir, name), "utf8").catch(() => null);
    const record = raw ? parseRecord(raw) : null;
    if (!record) continue;
    const exists = await readFile(record.path).then(() => true).catch(() => false);
    if (exists) records.push(record);
  }
  return records.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_LIST);
}

/** 读成 data URL 供预览：id 必须是合法素材 id，路径一律由目录 + 文件名拼出 */
export async function readImageDataUrl(id: string): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    return { ok: false, error: "素材 id 无效" };
  }
  const raw = await readFile(recordPath(id), "utf8").catch(() => null);
  const record = raw ? parseRecord(raw) : null;
  if (!record) {
    return { ok: false, error: "素材不存在" };
  }
  const buffer = await readFile(record.path).catch(() => null);
  if (!buffer) {
    return { ok: false, error: "素材文件已丢失" };
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    return { ok: false, error: "素材文件过大，无法预览" };
  }
  const mime = sniffImageMime(buffer);
  if (!mime) {
    return { ok: false, error: "素材不是受支持的图片格式" };
  }
  return { ok: true, dataUrl: `data:${mime};base64,${buffer.toString("base64")}` };
}

export async function deleteImage(id: string): Promise<{ ok: boolean; error?: string }> {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) {
    return { ok: false, error: "素材 id 无效" };
  }
  const raw = await readFile(recordPath(id), "utf8").catch(() => null);
  const record = raw ? parseRecord(raw) : null;
  if (!record) {
    return { ok: false, error: "素材不存在" };
  }
  await rm(record.path, { force: true }).catch(() => undefined);
  await rm(recordPath(id), { force: true }).catch(() => undefined);
  return { ok: true };
}

/**
 * 生成一张图并落盘。用户取消（abort）与超时都返回明确文案；
 * 供应商能力/认证不满足时在发请求前就拒绝。
 */
export async function generateImage(input: ImageGenerateInput): Promise<ImageGenerateResult> {
  const prompt = typeof input?.prompt === "string" ? input.prompt.trim() : "";
  if (!prompt) return { ok: false, error: "请填写图片描述" };
  if (prompt.length > MAX_PROMPT) return { ok: false, error: `图片描述不能超过 ${MAX_PROMPT} 字` };
  const size: ImageSize = IMAGE_SIZES.includes(input.size as ImageSize) ? (input.size as ImageSize) : "1024x1024";

  let target;
  try {
    target = await resolveImageModel(input.providerId, input.modelId, "图片生成");
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "图片生成不可用" };
  }

  const url = imageEndpoint(target.baseUrl, "generations");
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  // 供应商侧的硬超时与用户取消共用同一个 signal
  const timeout = AbortSignal.timeout(120_000);
  const onAbort = () => controller?.abort();
  timeout.addEventListener("abort", onAbort, { once: true });

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${target.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model: target.model.id, prompt, size, n: 1, response_format: "b64_json" }),
        signal: AbortSignal.any([signal, timeout]),
      });
    } catch {
      if (signal.aborted && !timeout.aborted) return { ok: false, error: "已取消生成" };
      if (timeout.aborted) return { ok: false, error: "图片生成超时，请稍后重试" };
      return { ok: false, error: "图片生成请求失败，请检查网络后重试" };
    }
    if (!response.ok) {
      return { ok: false, error: await providerErrorMessage(response, target.apiKey, RESPONSE_LIMIT, "图片生成") };
    }

    let payload: unknown;
    try {
      payload = await readLimitedJson(response, RESPONSE_LIMIT, "图片生成");
    } catch (error) {
      if (error instanceof Error && error.message.includes("响应过大")) {
        return { ok: false, error: error.message };
      }
      return { ok: false, error: "图片生成供应商响应格式无效" };
    }
    const item = (payload as { data?: Array<{ b64_json?: unknown; url?: unknown }> } | null)?.data?.[0];
    if (typeof item?.b64_json !== "string") {
      return {
        ok: false,
        error: typeof item?.url === "string"
          ? "供应商返回了图片链接而非图片数据，该模型可能不支持 b64_json 输出"
          : "供应商未返回图片数据",
      };
    }

    let buffer: Buffer;
    let mime: keyof typeof EXTENSIONS;
    try {
      buffer = decodeBase64(item.b64_json, MAX_IMAGE_BYTES, "生成图片");
      const sniffed = sniffImageMime(buffer);
      if (!sniffed) return { ok: false, error: "供应商返回的图片格式不受支持（仅 PNG / JPEG / WebP）" };
      mime = sniffed;
      imageSize(buffer);
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : "生成图片解码失败" };
    }

    const dimensions = imageSize(buffer);
    const id = `img-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const dir = zenImagesDir();
    const fileName = `${id}.${EXTENSIONS[mime]}`;
    const path = join(dir, fileName);
    await mkdir(dir, { recursive: true });
    await writeFile(path, buffer);
    const record: GeneratedImageRecord = {
      id,
      prompt,
      providerId: target.provider.id,
      modelId: target.model.id,
      width: dimensions.width,
      height: dimensions.height,
      sizeBytes: buffer.length,
      createdAt: Date.now(),
      path,
      fileName,
    };
    try {
      await writeFile(recordPath(id), JSON.stringify(record), "utf8");
    } catch (error) {
      // 元数据写失败就删掉图片，避免留下无法在素材库出现的孤儿文件
      await rm(path, { force: true }).catch(() => undefined);
      return { ok: false, error: error instanceof Error ? error.message : "素材记录写入失败" };
    }
    return { ok: true, record };
  } finally {
    timeout.removeEventListener("abort", onAbort);
    controller = null;
  }
}
