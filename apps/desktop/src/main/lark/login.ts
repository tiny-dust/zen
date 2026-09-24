import { spawn } from "node:child_process";

import type { LarkLoginEvent } from "@zen/shared";

import { invalidateLarkAuthCache, readLarkAuthSnapshot } from "./auth";
import { resolveLarkCliPath } from "./cli";

/**
 * 飞书登录：驱动 lark-cli device flow。
 * 1) `auth login --no-wait --recommend --json` 立即返回 verification_url + device_code；
 * 2) 把 URL 推给渲染层供用户在浏览器完成授权；
 * 3) 后台 `auth login --device-code <code>` 轮询直至授权完成（或超时/取消）。
 * 全程无交互，token 只留在 lark-cli 侧，主进程仅持有可展示的 URL。
 */

interface LarkLoginFlow {
  deviceCode: string;
  poller: ReturnType<typeof spawn>;
  /** device_code 过期（expires_in，实测 600s）后强制终止 */
  timeout: NodeJS.Timeout;
  cancelled: boolean;
}

let flow: LarkLoginFlow | null = null;

function emit(emitEvent: ((event: LarkLoginEvent) => void) | null, event: LarkLoginEvent): void {
  emitEvent?.(event);
}

/** 解析 lark-cli --json 输出；CLI 把业务错误也以 JSON 打在 stdout（ok:false） */
function parseCliJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf("{");
  if (start < 0) {
    return null;
  }
  try {
    return JSON.parse(raw.slice(start)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function cliErrorMessage(raw: string, fallback: string): string {
  const parsed = parseCliJson(raw);
  const error = parsed?.["error"];
  const message =
    error && typeof error === "object" ? (error as { message?: unknown }).message : null;
  if (typeof message === "string" && message) {
    return `lark-cli 登录失败：${message}`;
  }
  const text = raw.trim();
  return text ? `lark-cli 登录失败：${text.slice(0, 300)}` : fallback;
}

function finishFlow(): void {
  if (!flow) {
    return;
  }
  clearTimeout(flow.timeout);
  flow = null;
}

export function isLarkLoginRunning(): boolean {
  return flow !== null;
}

/**
 * 发起飞书登录。emitEvent 用于把各阶段事件推给渲染层；
 * 已有流程在跑时抛错（渲染层据此提示，不重复发起）。
 */
export async function startLarkLogin(
  emitEvent: (event: LarkLoginEvent) => void,
): Promise<void> {
  if (flow) {
    throw new Error("飞书登录已在进行中，请先完成或取消当前登录");
  }
  const cliPath = resolveLarkCliPath();
  if (!cliPath) {
    emit(emitEvent, {
      status: "error",
      message: "未找到 lark-cli 可执行文件，请先 npm install -g @larksuite/cli",
    });
    return;
  }

  // 阶段 1：立即拿到授权链接（不阻塞等待授权）
  let stdout = "";
  let stderr = "";
  try {
    const init = await new Promise<{ code: number; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(cliPath, ["auth", "login", "--no-wait", "--recommend", "--json"]);
        child.stdout?.on("data", (chunk: Buffer) => {
          stdout += chunk.toString();
        });
        child.stderr?.on("data", (chunk: Buffer) => {
          stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
      },
    );
    const parsed = parseCliJson(init.stdout);
    const url = parsed?.["verification_url"];
    const deviceCode = parsed?.["device_code"];
    const expiresIn = typeof parsed?.["expires_in"] === "number" ? parsed["expires_in"] : 600;
    if (init.code !== 0 || typeof url !== "string" || typeof deviceCode !== "string") {
      emit(emitEvent, {
        status: "error",
        message: cliErrorMessage(
          `${init.stdout}\n${init.stderr}`,
          "lark-cli 发起授权失败，请确认 lark-cli 可用后重试",
        ),
      });
      return;
    }

    // 阶段 2：后台轮询直至用户在浏览器完成授权
    const poller = spawn(cliPath, ["auth", "login", "--device-code", deviceCode, "--json"]);
    let pollerOut = "";
    poller.stdout?.on("data", (chunk: Buffer) => {
      pollerOut += chunk.toString();
    });
    poller.stderr?.on("data", (chunk: Buffer) => {
      pollerOut += `${chunk.toString()}\n`;
    });
    const current: LarkLoginFlow = {
      deviceCode,
      poller,
      cancelled: false,
      timeout: setTimeout(
        () => {
          const running = flow;
          finishFlow();
          running?.poller.kill();
          emit(emitEvent, { status: "error", message: "授权超时，请重新发起飞书登录" });
        },
        (Number(expiresIn) + 30) * 1000,
      ),
    };
    flow = current;
    emit(emitEvent, { status: "url", url, expiresInSeconds: Number(expiresIn) });

    // spawn 失败会通过 error 事件上报；没有监听会让 Electron 主进程收到未捕获异常并退出。
    poller.on("error", (error) => {
      if (flow !== current) {
        return;
      }
      current.cancelled = true;
      finishFlow();
      emit(emitEvent, {
        status: "error",
        message: error instanceof Error ? error.message : "lark-cli 授权轮询启动失败",
      });
    });

    poller.on("close", async (code) => {
      // 只有仍是当前流程时才收敛结果（被取消/已被超时清理则静默）
      if (flow !== current) {
        return;
      }
      finishFlow();
      if (current.cancelled) {
        return;
      }
      if (code !== 0) {
        emit(emitEvent, {
          status: "error",
          message: cliErrorMessage(pollerOut, "lark-cli 授权轮询失败，请重试"),
        });
        return;
      }
      invalidateLarkAuthCache();
      const snapshot = await readLarkAuthSnapshot().catch(() => null);
      if (!snapshot?.userOpenId) {
        emit(emitEvent, {
          status: "error",
          message: "授权已完成，但未取到飞书身份，请稍后在设置中重新检测",
        });
        return;
      }
      emit(emitEvent, { status: "done" });
    });
  } catch (error) {
    finishFlow();
    emit(emitEvent, {
      status: "error",
      message: error instanceof Error ? error.message : "lark-cli 启动失败",
    });
  }
}

/** 取消登录：杀掉轮询子进程并广播 cancelled */
export function cancelLarkLogin(emitEvent: (event: LarkLoginEvent) => void): void {
  const current = flow;
  if (!current) {
    return;
  }
  current.cancelled = true;
  finishFlow();
  current.poller.kill();
  emit(emitEvent, { status: "cancelled" });
}

/** will-quit 收尾：杀掉残留轮询进程（不再广播） */
export function shutdownLarkLogin(): void {
  const current = flow;
  if (!current) {
    return;
  }
  current.cancelled = true;
  finishFlow();
  current.poller.kill();
}
