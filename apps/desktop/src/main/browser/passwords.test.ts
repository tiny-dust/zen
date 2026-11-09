import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = vi.hoisted(() => ({ dir: "" }));

vi.mock("../secret", () => ({
  encryptSecret: async (value: string) => `enc:${value}`,
  decryptSecret: async (value: string) => value.replace(/^enc:/, ""),
}));
vi.mock("../zen-dir", () => ({ zenRoot: () => root.dir }));

import { listStoredPasswords, revealPassword, saveCapturedPassword } from "./passwords";

beforeEach(() => {
  root.dir = mkdtempSync(join(tmpdir(), "zen-passwords-"));
});

afterEach(() => {
  rmSync(root.dir, { recursive: true, force: true });
});

describe("保存浏览器捕获的登录密码", () => {
  it("HTTPS 站点写入密码库并按 origin + 用户名去重", async () => {
    expect(await saveCapturedPassword({
      url: "https://example.com/login?next=/",
      username: "alice",
      password: "s3cret",
    })).toBe("saved");

    const entries = listStoredPasswords();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ origin: "https://example.com", username: "alice" });
    expect(await revealPassword(entries[0]!.id)).toBe("s3cret");

    // 同一凭据再次提交：静默判重，不新增
    expect(await saveCapturedPassword({
      url: "https://example.com/login",
      username: "alice",
      password: "s3cret",
    })).toBe("exists");
    expect(listStoredPasswords()).toHaveLength(1);
  });

  it("同一用户名改密码会覆盖旧密码", async () => {
    await saveCapturedPassword({ url: "https://example.com/", username: "alice", password: "old" });
    expect(await saveCapturedPassword({
      url: "https://example.com/",
      username: "alice",
      password: "new",
    })).toBe("saved");
    const [entry] = listStoredPasswords();
    expect(await revealPassword(entry!.id)).toBe("new");
  });

  it("拒绝 http 站点与空密码", async () => {
    expect(await saveCapturedPassword({
      url: "http://example.com/",
      username: "alice",
      password: "s3cret",
    })).toBe("insecure");
    expect(await saveCapturedPassword({
      url: "https://example.com/",
      username: "alice",
      password: "",
    })).toBe("empty");
    expect(listStoredPasswords()).toHaveLength(0);
  });
});
