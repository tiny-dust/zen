/** 任务需要确认 / 运行结束时的轻量提示音（Web Audio，无外部资源） */

export type NotifySoundKind = "needsAction" | "done" | "error";

let audioCtx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const Ctor = window.AudioContext || (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) {
    return null;
  }
  if (!audioCtx) {
    audioCtx = new Ctor();
  }
  return audioCtx;
}

function tone(ctx: AudioContext, freq: number, startAt: number, duration: number, gainPeak = 0.04) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(gainPeak, startAt + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

/** 播放提示音；自动播放策略被拦时静默失败 */
export function playNotifySound(kind: NotifySoundKind): void {
  try {
    const ctx = ensureCtx();
    if (!ctx) {
      return;
    }
    if (ctx.state === "suspended") {
      void ctx.resume();
    }
    const now = ctx.currentTime;
    if (kind === "needsAction") {
      // 两声上行短音：需要你确认
      tone(ctx, 784, now, 0.07);
      tone(ctx, 1046.5, now + 0.09, 0.1);
      return;
    }
    if (kind === "done") {
      // 三音上行：任务结束
      tone(ctx, 523.25, now, 0.07);
      tone(ctx, 659.25, now + 0.08, 0.07);
      tone(ctx, 783.99, now + 0.16, 0.12);
      return;
    }
    // error：下行双音
    tone(ctx, 392, now, 0.09);
    tone(ctx, 293.66, now + 0.1, 0.14);
  } catch {
    // 忽略音频设备/策略错误
  }
}
