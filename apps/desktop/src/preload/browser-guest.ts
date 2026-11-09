import { ipcRenderer } from "electron";

/**
 * 内嵌浏览器 guest 页的 preload：只在登录表单提交时把「用户名 + 密码」交给主进程。
 * 不写 DOM、不拦默认行为、不自动提交；是否保存由主进程弹窗询问用户。
 */

const CHANNEL = "browser:password-candidate";

/** 用户名候选关键字：name/id/autocomplete 命中优先，其次回落到第一个文本类输入框 */
const USERNAME_HINT = /user|email|account|login|phone|mobile|uname/i;

function credentialFrom(form: HTMLFormElement): { username: string; password: string } | null {
  const passwords = Array.from(
    form.querySelectorAll<HTMLInputElement>('input[type="password"]'),
  ).filter((input) => input.value.length > 0);
  // 注册/改密表单常有两个密码框，无法确定哪个是登录密码，直接跳过
  if (passwords.length !== 1) {
    return null;
  }
  const password = passwords[0]!;
  const candidates = Array.from(form.querySelectorAll<HTMLInputElement>("input")).filter(
    (input) => input !== password && input.value.trim().length > 0,
  );
  const userField =
    candidates.find((input) =>
      USERNAME_HINT.test(`${input.name} ${input.id} ${input.getAttribute("autocomplete") ?? ""}`),
    ) ??
    candidates.find((input) => input.type === "email" || input.type === "text" || input.type === "") ??
    null;
  return { username: userField?.value.trim() ?? "", password: password.value };
}

document.addEventListener(
  "submit",
  (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) {
      return;
    }
    const credential = credentialFrom(form);
    if (!credential) {
      return;
    }
    ipcRenderer.send(CHANNEL, { ...credential, url: location.href });
  },
  true,
);
