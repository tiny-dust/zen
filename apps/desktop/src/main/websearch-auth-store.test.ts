import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ root: "" }));

vi.mock("electron", () => ({
  // aes:v1 主方案不依赖 safeStorage，mock 仅为满足模块顶层导入
  safeStorage: { isEncryptionAvailable: () => false },
  app: {},
}));

vi.mock("./zen-dir", () => ({
  zenRoot: () => state.root,
}));

import {
  getWebSearchApiKeys,
  getWebSearchStatus,
  saveWebSearchApiKey,
} from "./websearch-auth-store";

function authFile(): string {
  return join(state.root, "websearch-auth.json");
}

describe("websearch-auth-store", () => {
  beforeEach(async () => {
    state.root = await mkdtemp(join(tmpdir(), "zen-websearch-"));
  });

  afterEach(async () => {
    await rm(state.root, { recursive: true, force: true });
  });

  it("存后读回解密一致，且落盘文件不含明文", async () => {
    await saveWebSearchApiKey("tavily", "tvly-secret-12345678");

    const keys = await getWebSearchApiKeys();
    expect(keys.tavily).toBe("tvly-secret-12345678");

    const raw = await readFile(authFile(), "utf8");
    expect(raw).not.toContain("tvly-secret-12345678");
    expect(raw).toContain("apiKeyEnc");
  });

  it("status 返回三个供应商固定条目，配置项带脱敏预览", async () => {
    await saveWebSearchApiKey("bocha", "bocha-key-abcdef1234");

    const status = await getWebSearchStatus();
    expect(status.bocha.configured).toBe(true);
    expect(status.bocha.masked).toContain("••••");
    expect(status.tavily).toEqual({ configured: false });
    expect(status.serper).toEqual({ configured: false });
  });

  it("null/空串清除条目（清除语义）", async () => {
    await saveWebSearchApiKey("serper", "serper-key-1234567890");
    await saveWebSearchApiKey("serper", null);
    expect((await getWebSearchApiKeys()).serper).toBeUndefined();

    await saveWebSearchApiKey("tavily", "   ");
    expect((await getWebSearchApiKeys()).tavily).toBeUndefined();
  });

  it("密文损坏时跳过该供应商，不抛错", async () => {
    await saveWebSearchApiKey("tavily", "tvly-key-1234567890");
    const data = JSON.parse(await readFile(authFile(), "utf8"));
    data.tavily.apiKeyEnc = "aes:v1:!!!corrupted!!!";
    await writeFile(authFile(), JSON.stringify(data), "utf8");

    expect((await getWebSearchApiKeys()).tavily).toBeUndefined();
    expect((await getWebSearchStatus()).tavily.configured).toBe(false);
  });
});
