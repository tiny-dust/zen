import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listChromiumProfiles } from "./import";
import { decryptCbcPassword, decryptWindowsPassword, importNativePasswords } from "./native-passwords";

vi.mock("./import", () => ({ listChromiumProfiles: vi.fn() }));

let root: string;
let profile: string;

function cbcBlob(password: string, keyPassword = "peanuts", iterations = 1): Buffer {
  const key = pbkdf2Sync(keyPassword, "saltysalt", iterations, 16, "sha1");
  const cipher = createCipheriv("aes-128-cbc", key, Buffer.alloc(16, 0x20));
  return Buffer.concat([Buffer.from("v10"), cipher.update(password), cipher.final()]);
}

function createLoginDb(blob: Buffer): void {
  const db = new Database(join(profile, "Login Data"));
  db.exec("CREATE TABLE logins (origin_url TEXT, username_value TEXT, password_value BLOB)");
  db.prepare("INSERT INTO logins VALUES (?, ?, ?)").run("https://example.com/login", "someone", blob);
  db.close();
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "zen-native-password-test-"));
  profile = join(root, "Default");
  mkdirSync(profile);
  vi.mocked(listChromiumProfiles).mockResolvedValue([{ id: "chrome", name: "Chrome", dir: profile }]);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("native browser passwords", () => {
  it("decrypts supported Chromium CBC and Windows GCM formats", () => {
    expect(decryptCbcPassword(cbcBlob("mac-secret", "keychain-value", 1003), "keychain-value", 1003)).toBe("mac-secret");
    const key = randomBytes(32);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const blob = Buffer.concat([Buffer.from("v10"), nonce, cipher.update("windows-secret"), cipher.final(), cipher.getAuthTag()]);
    expect(decryptWindowsPassword(blob, key)).toBe("windows-secret");
  });

  it("imports a Linux Chromium v10 password from a local profile", async () => {
    createLoginDb(cbcBlob("my-password"));

    expect(await importNativePasswords("chrome", "linux")).toEqual({
      ok: true,
      rows: [{ name: "example.com", url: "https://example.com", username: "someone", password: "my-password" }],
      skipped: 0,
    });
  });

  it("reports app-bound encryption and unreadable profiles instead of false success", async () => {
    createLoginDb(Buffer.concat([Buffer.from("v20"), randomBytes(32)]));
    const appBound = await importNativePasswords("chrome", "win32");
    expect(appBound.ok).toBe(false);
    expect(appBound.error).toContain("CSV");

    rmSync(join(profile, "Login Data"));
    writeFileSync(join(profile, "Login Data"), "not a SQLite database");
    const unreadable = await importNativePasswords("chrome", "linux");
    expect(unreadable.ok).toBe(false);
    expect(unreadable.error).toContain("CSV");
  });

  it("reports unsupported Firefox and Safari direct import with CSV guidance", async () => {
    expect((await importNativePasswords("firefox", "linux")).error).toContain("CSV");
    expect((await importNativePasswords("safari", "darwin")).error).toContain("CSV");
  });
});
