import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { WebSearchApiProviderId, WebSearchStatus } from "@zen/shared";

import { decryptSecret, encryptSecret, maskSecret } from "./secret";
import { zenRoot } from "./zen-dir";

/**
 * 网络搜索供应商 API Key 存储（~/.zen/websearch-auth.json）：一律密文（aes:v1）。
 * 该文件含密钥，只允许本模块读写；config-sync 仅同步 zen-config.json / mcp.json，
 * 严禁把 websearch-auth.json 加入云同步或任何导出。
 */

/** 支持配置 Key 的固定供应商清单（status 展示与 IPC 校验共用） */
export const WEB_SEARCH_API_PROVIDERS = ["tavily", "bocha", "serper"] as const;

interface StoredApiKey {
  apiKeyEnc: string;
}

type WebSearchAuthFile = Partial<Record<WebSearchApiProviderId, StoredApiKey>>;

function webSearchAuthFile(): string {
  return join(zenRoot(), "websearch-auth.json");
}

async function readAuthFile(): Promise<WebSearchAuthFile> {
  try {
    const parsed: unknown = JSON.parse(await readFile(webSearchAuthFile(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    return parsed as WebSearchAuthFile;
  } catch {
    return {};
  }
}

async function writeAuthFile(data: WebSearchAuthFile): Promise<void> {
  const file = webSearchAuthFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

/** 读回解密后的 API Key；条目缺失或密文损坏跳过该供应商（按未配置处理），不抛 */
export async function getWebSearchApiKeys(): Promise<Partial<Record<WebSearchApiProviderId, string>>> {
  const data = await readAuthFile();
  const keys: Partial<Record<WebSearchApiProviderId, string>> = {};
  for (const provider of WEB_SEARCH_API_PROVIDERS) {
    const entry = data[provider];
    if (!entry?.apiKeyEnc) {
      continue;
    }
    try {
      const apiKey = await decryptSecret(entry.apiKeyEnc);
      if (apiKey) {
        keys[provider] = apiKey;
      }
    } catch {
      // 密文损坏（换机/密钥文件变更）：不把坏 key 注入请求头，按未配置处理
    }
  }
  return keys;
}

/** key 为空/null 时删除该条目（清除语义），否则覆盖加密保存 */
export async function saveWebSearchApiKey(
  provider: WebSearchApiProviderId,
  key: string | null,
): Promise<void> {
  const data = await readAuthFile();
  const trimmed = typeof key === "string" ? key.trim() : "";
  if (!trimmed) {
    if (!data[provider]) {
      return;
    }
    delete data[provider];
    await writeAuthFile(data);
    return;
  }
  data[provider] = { apiKeyEnc: await encryptSecret(trimmed) };
  await writeAuthFile(data);
}

/** 设置页状态：每个供应商固定返回一项；masked 为脱敏预览，明文不出本模块 */
export async function getWebSearchStatus(): Promise<WebSearchStatus> {
  const keys = await getWebSearchApiKeys();
  const status = {} as WebSearchStatus;
  for (const provider of WEB_SEARCH_API_PROVIDERS) {
    const apiKey = keys[provider];
    status[provider] = apiKey
      ? { configured: true, masked: maskSecret(apiKey) }
      : { configured: false };
  }
  return status;
}
