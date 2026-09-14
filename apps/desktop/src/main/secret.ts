import { safeStorage } from "electron";

export async function encryptSecret(plain: string): Promise<string> {
  if (safeStorage.isEncryptionAvailable()) {
    const buf = await safeStorage.encryptStringAsync(plain);
    return buf.toString("base64");
  }
  return Buffer.from(`plain:${plain}`, "utf8").toString("base64");
}

export async function decryptSecret(encoded: string): Promise<string> {
  const raw = Buffer.from(encoded, "base64");
  if (safeStorage.isEncryptionAvailable()) {
    try {
      const { result } = await safeStorage.decryptStringAsync(raw);
      return result;
    } catch {
      // plain-prefixed fallback
    }
  }
  const text = raw.toString("utf8");
  return text.startsWith("plain:") ? text.slice("plain:".length) : text;
}

export function maskSecret(plain: string): string {
  if (!plain) {
    return "";
  }
  if (plain.length <= 8) {
    return "••••••";
  }
  return `${plain.slice(0, 3)}••••${plain.slice(-4)}`;
}
