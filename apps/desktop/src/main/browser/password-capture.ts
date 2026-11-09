import { createHash } from "node:crypto";

import { BrowserWindow, dialog, ipcMain } from "electron";

import { currentLocale, mainT } from "../i18n";
import { listStoredPasswords, revealPassword, saveCapturedPassword } from "./passwords";

/**
 * 内嵌浏览器「保存密码」：guest preload 在登录表单提交时上报凭据，
 * 主进程校验来源与 HTTPS、去重后弹系统确认框，确认才加密写入密码库。
 *
 * 只在用户点「保存」时落库；密码明文不写日志、不回渲染层，弹窗只展示站点与用户名。
 */

export const PASSWORD_CANDIDATE_CHANNEL = "browser:password-candidate";

/** 已处理过的凭据指纹：避免同一表单反复弹窗（进程内，重启清空） */
const handled = new Set<string>();
const HANDLED_LIMIT = 200;

interface CandidatePayload {
  url?: unknown;
  username?: unknown;
  password?: unknown;
}

function fingerprint(url: string, username: string, password: string): string {
  return createHash("sha256").update(`${url}\0${username}\0${password}`).digest("hex");
}

/** 已存在同 origin + 用户名且密码一致时，静默跳过，不打扰用户 */
async function alreadyStored(origin: string, username: string, password: string): Promise<boolean> {
  const match = listStoredPasswords().find(
    (entry) => entry.origin === origin && entry.username === username,
  );
  if (!match) {
    return false;
  }
  return (await revealPassword(match.id)) === password;
}

async function handleCandidate(event: Electron.IpcMainEvent, payload: CandidatePayload) {
  const password = typeof payload?.password === "string" ? payload.password : "";
  const username = typeof payload?.username === "string" ? payload.username.trim() : "";
  const url = typeof payload?.url === "string" ? payload.url : "";
  if (!password || !url.startsWith("https://")) {
    return;
  }

  const sender = event.sender;
  if (sender.isDestroyed()) {
    return;
  }
  // 只接受当前文档上报：SPA 里过期的旧表单不处理
  let origin: string;
  try {
    origin = new URL(url).origin;
    if (new URL(sender.getURL()).origin !== origin) {
      return;
    }
  } catch {
    return;
  }

  const key = fingerprint(url, username, password);
  if (handled.has(key)) {
    return;
  }
  handled.add(key);
  if (handled.size > HANDLED_LIMIT) {
    const oldest = handled.values().next().value;
    if (oldest) handled.delete(oldest);
  }

  if (await alreadyStored(origin, username, password)) {
    return;
  }

  const host = new URL(url).host;
  const locale = await currentLocale();
  const options: Electron.MessageBoxOptions = {
    type: "question",
    noLink: true,
    defaultId: 0,
    cancelId: 1,
    buttons: [
      mainT(locale, "browser.savePasswordConfirm"),
      mainT(locale, "browser.savePasswordCancel"),
    ],
    title: mainT(locale, "browser.savePasswordTitle"),
    message: mainT(locale, "browser.savePasswordMessage", { host }),
    ...(username ? { detail: mainT(locale, "browser.savePasswordDetail", { username }) } : {}),
  };
  const win = BrowserWindow.fromWebContents(sender);
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  if (response !== 0) {
    return;
  }
  await saveCapturedPassword({ url, username, password });
}

let installed = false;

/** 幂等注册 IPC 监听（每个应用进程只装一次） */
export function installPasswordCapture(): void {
  if (installed) {
    return;
  }
  installed = true;
  ipcMain.on(PASSWORD_CANDIDATE_CHANNEL, (event, payload: CandidatePayload) => {
    void handleCandidate(event, payload).catch(() => undefined);
  });
}
