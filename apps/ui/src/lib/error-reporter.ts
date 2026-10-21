import type { ComponentInternalInstance, ComponentPublicInstance, App } from "vue";

import type { ErrorReportPayload } from "@zen/shared";

/** 进程内节流窗口：相同 message 在窗口内的重复上报丢弃（防止高频刷屏） */
const THROTTLE_WINDOW_MS = 5000;

/**
 * 节流判定（纯函数）：5 秒窗口内相同 message 只放行一次。
 * seen 由调用方持有（message → 上次放行时间戳），命中即视为已上报并更新时间。
 */
export function shouldReportMessage(
  seen: Map<string, number>,
  message: string,
  now: number,
  windowMs: number = THROTTLE_WINDOW_MS,
): boolean {
  const last = seen.get(message);
  if (last != null && now - last < windowMs) {
    return false;
  }
  seen.set(message, now);
  return true;
}

/**
 * unhandledrejection 的 reason → message/stack（纯函数）：
 * Error 取 message/stack，字符串原样，其余安全 String 化（失败给兜底文案）。
 */
export function describeReason(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return { message: reason.message, stack: reason.stack };
  }
  if (typeof reason === "string") {
    return { message: reason };
  }
  try {
    return { message: String(reason) };
  } catch {
    return { message: "unknown rejection" };
  }
}

/**
 * window error 事件 → 上报载荷（纯函数）：
 * target 是元素（资源加载失败，src/href 之一承载地址）→ resource-error；
 * 否则是全局脚本错误 → window-error。
 */
export function payloadFromErrorEvent(event: Event): ErrorReportPayload {
  // 资源加载失败的 target 是元素（脚本错误的 target 是 window）
  const target = (event as ErrorEvent).target;
  if (target instanceof HTMLElement) {
    const element = target as HTMLElement & { src?: string; href?: string };
    const url = element.src || element.href || element.tagName;
    return { kind: "resource-error", message: `资源加载失败: ${url}` };
  }
  const errorEvent = event as ErrorEvent;
  return {
    kind: "window-error",
    message: errorEvent.message || "未知错误",
    stack: errorEvent.error instanceof Error ? errorEvent.error.stack : undefined,
  };
}

/** Vue 组件链：从出错组件向上收集名称（≤5 层），供定位「在哪个组件里炸的」 */
export function componentChainOf(instance: ComponentPublicInstance | null): string {
  const names: string[] = [];
  // errorHandler 回调给的是公开实例（$ 指向内部实例，链挂在内部实例上）
  let cursor: ComponentInternalInstance | null = instance?.$ ?? null;
  while (cursor && names.length < 5) {
    const name = cursor.type.name ?? (cursor.type as { __name?: string }).__name;
    if (name) {
      names.push(name);
    }
    cursor = cursor.parent;
  }
  return names.join(" → ");
}

/** Vue errorHandler 的 err/info → 上报载荷（纯函数） */
export function payloadFromVueError(
  err: unknown,
  instance: ComponentPublicInstance | null,
  info: string,
): ErrorReportPayload {
  const message = err instanceof Error ? err.message : String(err);
  const chain = componentChainOf(instance);
  const suffix = [chain, info].filter(Boolean).join(" · ");
  return {
    kind: "vue",
    message: suffix ? `${message} (${suffix})` : message,
    stack: err instanceof Error ? err.stack : undefined,
  };
}

/** 组装上报动作：节流 + fire-and-forget，任何失败静默（上报链路绝不能再抛错） */
function createReporter() {
  const seen = new Map<string, number>();
  return (payload: ErrorReportPayload): void => {
    try {
      if (!shouldReportMessage(seen, payload.message, Date.now())) {
        return;
      }
      void window.zen?.errors?.report?.(payload)?.catch(() => undefined);
    } catch {
      // 静默：错误上报自身不允许成为新错误源
    }
  };
}

/**
 * 渲染层异常采集：window error（捕获阶段，含资源加载失败）、unhandledrejection、
 * Vue errorHandler 三路汇总到主进程异常中心。main.ts 在 mount 前安装。
 */
export function installErrorReporter(app: App): void {
  const report = createReporter();

  try {
    // 捕获阶段才能收到资源加载失败（资源 error 不冒泡到 window）
    window.addEventListener("error", (event) => {
      try {
        report(payloadFromErrorEvent(event));
      } catch {
        // 静默
      }
    }, true);
  } catch {
    // 静默
  }

  try {
    window.addEventListener("unhandledrejection", (event) => {
      try {
        const { message, stack } = describeReason(event.reason);
        report({ kind: "unhandled", message, stack });
      } catch {
        // 静默
      }
    });
  } catch {
    // 静默
  }

  try {
    const previous = app.config.errorHandler;
    app.config.errorHandler = (err, instance, info) => {
      try {
        report(payloadFromVueError(err, instance, info));
      } catch {
        // 静默
      }
      if (typeof previous === "function") {
        try {
          previous(err, instance, info);
        } catch {
          // 静默
        }
      }
    };
  } catch {
    // 静默
  }
}
