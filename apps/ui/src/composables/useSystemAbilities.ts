import { ref } from "vue";

import type { AbilityProbe } from "@zen/shared";

/**
 * 系统层能力四件套的渲染层状态（语音输入 / TTS / OCR）。
 * - probe 结果模块级缓存一次：多个组件（Composer 麦克风、消息朗读、附件 OCR）共享；
 * - 平台不支持时 supported=false，对应入口直接隐藏（安全降级，不崩）；
 * - window.zen 缺失（单测 stub）或 IPC 异常一律按「不支持」处理，绝不抛错进组件；
 * - CUA 是 agent 工具域，无渲染层操作入口，此处不探测。
 */

const UNSUPPORTED: AbilityProbe = { supported: false, reason: "能力探测失败" };

interface ProbeState {
  probe: AbilityProbe | null;
  promise: Promise<AbilityProbe> | null;
}

const voiceState: ProbeState = { probe: null, promise: null };
const ttsState: ProbeState = { probe: null, promise: null };
const ocrState: ProbeState = { probe: null, promise: null };

/** 探测能力（模块级缓存；任何异常按不支持处理，不抛出到组件） */
function ensureProbe(
  state: ProbeState,
  invoke: () => Promise<AbilityProbe> | undefined,
): Promise<AbilityProbe> {
  if (state.probe) {
    return Promise.resolve(state.probe);
  }
  state.promise ??= Promise.resolve()
    .then(() => invoke() ?? UNSUPPORTED)
    .then((probe) => {
      state.probe = probe;
      return probe;
    })
    .catch(() => {
      state.probe = UNSUPPORTED;
      return UNSUPPORTED;
    });
  return state.promise;
}

/** 语音输入（点击开始 → 再点结束 → 转写文本回填输入框） */
export function useVoiceInput() {
  const supported = ref(false);
  const recording = ref(false);
  const transcribing = ref(false);

  void ensureProbe(voiceState, () => window.zen?.voice?.probe()).then((probe) => {
    supported.value = probe.supported;
  });

  /** 返回 null=本次点击只切换录音态；出错抛出消息供调用方提示 */
  async function toggle(): Promise<string | null> {
    if (!supported.value || transcribing.value) {
      return null;
    }
    if (!recording.value) {
      const started = await window.zen?.voice?.start();
      if (!started?.ok) {
        throw new Error(started?.error ?? "无法开始录音");
      }
      recording.value = true;
      return null;
    }
    recording.value = false;
    transcribing.value = true;
    try {
      const result = await window.zen?.voice?.stop();
      if (!result?.ok) {
        throw new Error(result?.error ?? "语音识别失败");
      }
      const text = result.text?.trim() ?? "";
      if (!text) {
        throw new Error("EMPTY");
      }
      return text;
    } finally {
      transcribing.value = false;
    }
  }

  return { supported, recording, transcribing, toggle };
}

/** TTS 播报（助手消息「朗读」/「停止」） */
export function useTts() {
  const supported = ref(false);
  /** 当前正在朗读的消息 id（模块级共享：一条在播时其它消息显示「停止」） */
  const speakingId = ref<string | null>(null);

  void ensureProbe(ttsState, () => window.zen?.tts?.probe()).then((probe) => {
    supported.value = probe.supported;
  });

  /** 朗读指定消息；再次点击同一消息则停止 */
  async function toggle(messageId: string, text: string): Promise<void> {
    if (!supported.value) {
      return;
    }
    if (speakingId.value === messageId) {
      await window.zen?.tts?.stop();
      speakingId.value = null;
      return;
    }
    if (speakingId.value != null) {
      // 切换朗读目标：先打断旧的
      await window.zen?.tts?.stop();
    }
    const result = await window.zen?.tts?.speak(text);
    if (result?.ok) {
      speakingId.value = messageId;
    } else {
      throw new Error(result?.error ?? "语音播报不可用");
    }
  }

  function stop(): void {
    if (speakingId.value != null) {
      void window.zen?.tts?.stop();
      speakingId.value = null;
    }
  }

  return { supported, speakingId, toggle, stop };
}

/** OCR（图片附件「识别文字」→ 结果回填输入框） */
export function useOcr() {
  const supported = ref(false);
  const recognizing = ref(false);

  void ensureProbe(ocrState, () => window.zen?.ocr?.probe()).then((probe) => {
    supported.value = probe.supported;
  });

  /** 识别图片；返回文本，失败/空结果抛出消息供调用方提示 */
  async function recognize(imagePath: string): Promise<string> {
    recognizing.value = true;
    try {
      const result = await window.zen?.ocr?.recognize(imagePath);
      if (!result?.ok) {
        throw new Error(result?.error ?? "文字识别失败");
      }
      const text = result.text?.trim() ?? "";
      if (!text) {
        throw new Error("EMPTY");
      }
      return text;
    } finally {
      recognizing.value = false;
    }
  }

  return { supported, recognizing, recognize };
}
