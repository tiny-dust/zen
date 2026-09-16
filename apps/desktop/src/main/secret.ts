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
      // 系统钥匙串解密失败（重装/换机/密钥变更）：不要把密文当 utf8 读，
      // 否则会得到 U+FFFD，再进 HTTP header 就会 ByteString 崩溃。
      const text = raw.toString("utf8");
      if (text.startsWith("plain:")) {
        return text.slice("plain:".length);
      }
      throw new Error("本地密钥无法解密已保存的凭据，请重新登录或重新填写");
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

/** HTTP header 值必须是 ByteString；出现非 Latin-1 / 替换符时 fetch 会直接 TypeError */
export function isByteSafeHeader(value: string): boolean {
  if (!value) {
    return false;
  }
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0xfffd || code < 1 || code > 255) {
      return false;
    }
  }
  return !/[\r\n\0]/.test(value);
}
