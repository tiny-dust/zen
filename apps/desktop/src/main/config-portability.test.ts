import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => "/unused" } }));
vi.mock("./model-db-connection", () => ({ getDb: vi.fn() }));
vi.mock("./model-db", () => ({ listProviders: vi.fn(async () => [{
  id: "provider-1", name: "Example", protocol: "openai-chat", baseUrl: "https://example.test",
  apiKeyMask: "secret-mask", models: [{ id: "model-1", name: "Model", enabled: true, custom: false,
    capabilities: { vision: true } }],
}]) }));
vi.mock("./zen-dir", () => ({
  loadAgentSettings: vi.fn(async () => ({ permissionMode: "smart", sandboxMode: "direct",
    prompt: { presetId: "zen-default", version: "distilled", customText: "private prompt" } })),
  loadBrowserSettings: vi.fn(async () => ({ zoomPercent: 100, autoFillPasswords: true,
    userAgent: "private UA", pipBounds: null })),
  readMcpConfig: vi.fn(async () => ({ servers: [{ id: "server-1", name: "Server", transport: "stdio",
    command: "private-command", env: { API_KEY: "private-key" }, enabled: true }] })),
  saveAgentSettings: vi.fn(), saveBrowserSettings: vi.fn(), writeMcpConfig: vi.fn(),
  zenConfigFile: () => "/unused/config.json",
}));
vi.mock("./user-ipc", () => ({ loadAppSettings: vi.fn(async () => ({
  theme: "dark", accentColor: "orange", locale: "zh-CN", codeTheme: "github",
  displayAccount: "auto", updateFeedUrl: "private-feed", shortcuts: [],
})) }));

import { exportConfigFile, previewConfigFile } from "./config-portability";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "zen-config-test-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe("config portability", () => {
  it("encrypts an allowlisted payload without credentials, paths, commands, or custom prompts", async () => {
    const file = join(dir, "export.zenconfig");
    await exportConfigFile(file, "strong-password-123");
    const text = await readFile(file, "utf8");
    expect(text).toContain('"cipher":"aes-256-gcm"');
    for (const secret of ["secret-mask", "private prompt", "private-command", "private-key", "private UA", "private-feed"]) {
      expect(text).not.toContain(secret);
    }
    const preview = await previewConfigFile(file, "strong-password-123");
    expect(preview.groups.models.incoming).toBe(1);
    expect(preview.groups.mcp.incoming).toBe(1);
    await expect(previewConfigFile(file, "wrong-password")).rejects.toThrow("密码错误");
    await expect(exportConfigFile(file, "strong-password-123")).rejects.toMatchObject({ code: "EEXIST" });
  });
});
