/**
 * UUID v7：48bit 毫秒时间戳 + 随机位，时间有序且全局唯一。
 * 会话等实体的唯一 key 统一用它，避免不同来源生成的 id 撞车。
 * 同毫秒内用 12bit 计数器保证单调递增（RFC 9562 monotonic 做法）。
 * 纯实现无平台依赖：随机源取 globalThis.crypto（渲染层与 Node 18+ 均内置）。
 */

type CryptoLike = { getRandomValues(array: Uint8Array): Uint8Array };

function webCrypto(): CryptoLike {
  const c = (globalThis as unknown as { crypto?: CryptoLike }).crypto;
  if (!c?.getRandomValues) {
    throw new Error("crypto.getRandomValues 不可用，无法生成 uuidv7");
  }
  return c;
}

/** 上一次生成的时间戳与 12bit 同毫秒计数器（单调性保证） */
let lastTs = 0;
let lastRandA = 0;

export function uuidv7(): string {
  const bytes = new Uint8Array(16);
  webCrypto().getRandomValues(bytes);
  let ts = Date.now();
  let randA: number;
  if (ts === lastTs) {
    // 同毫秒：计数器 +1；溢出则推进时间戳
    randA = (lastRandA + 1) & 0xfff;
    if (randA === 0) {
      ts += 1;
    }
  } else {
    randA = (bytes[6]! << 8 | bytes[7]!) & 0xfff;
  }
  lastTs = ts;
  lastRandA = randA;

  bytes[0] = Number((ts / 2 ** 40) & 0xff);
  bytes[1] = Number((ts / 2 ** 32) & 0xff);
  bytes[2] = Number((ts / 2 ** 24) & 0xff);
  bytes[3] = Number((ts / 2 ** 16) & 0xff);
  bytes[4] = Number((ts / 2 ** 8) & 0xff);
  bytes[5] = Number(ts & 0xff);
  bytes[6] = (randA >> 8) | 0x70;
  bytes[7] = randA & 0xff;
  // variant 10（高 2 位）
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
