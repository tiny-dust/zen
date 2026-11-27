import { beforeEach, describe, expect, it, vi } from "vitest";

import { cancelVoiceInput, useTts } from "./useSystemAbilities";

const speak = vi.fn(async () => ({ ok: true }));
const stop = vi.fn(async () => ({ ok: true }));
let endedHandler: (() => void) | null = null;
/** 等 probe 的 promise 落地（supported 才能为 true） */
const flushProbe = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.stubGlobal("zen", {
    tts: {
      probe: async () => ({ supported: true }),
      speak,
      stop,
      onEnded: (handler: () => void) => {
        endedHandler = handler;
        return () => {
          endedHandler = null;
        };
      },
    },
    voice: {
      probe: async () => ({ supported: true }),
      start: async () => ({ ok: true }),
      stop,
      onPartial: () => () => undefined,
    },
  });
});

describe("useTts", () => {
  it("播报进程结束推送后复位朗读态（不再卡在「停止」）", async () => {
    const tts = useTts();
    await flushProbe();
    await tts.toggle("message-1", "hello");
    expect(tts.speakingId.value).toBe("message-1");

    // 主进程推来 tts:ended：自然读完也要复位
    endedHandler?.();
    expect(tts.speakingId.value).toBeNull();
  });

  it("再次点击同一消息先停播再清态", async () => {
    const tts = useTts();
    await flushProbe();
    await tts.toggle("message-2", "hello");
    stop.mockClear();
    await tts.toggle("message-2", "hello");
    expect(stop).toHaveBeenCalled();
    expect(tts.speakingId.value).toBeNull();
  });
});

describe("cancelVoiceInput", () => {
  it("停掉主进程录音（没有录音时忽略报错）", async () => {
    stop.mockClear();
    await cancelVoiceInput();
    expect(stop).toHaveBeenCalled();

    stop.mockRejectedValueOnce(new Error("没有进行中的录音"));
    await expect(cancelVoiceInput()).resolves.toBeUndefined();
  });
});
