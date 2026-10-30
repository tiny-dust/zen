import type { StoredPasswordEntry } from "@zen/shared";

interface FillPayload {
  expectedUrl: string;
  origin: string;
  username: string;
  password: string;
}

/** 只允许精确 HTTPS origin；子域、端口或协议变化都不能复用凭据。 */
export function securePageOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed.origin : null;
  } catch {
    return null;
  }
}

export function matchingPasswords(
  entries: StoredPasswordEntry[],
  pageUrl: string,
): StoredPasswordEntry[] {
  const origin = securePageOrigin(pageUrl);
  return origin ? entries.filter((entry) => entry.origin === origin) : [];
}

export function autoFillPasswordForPage(
  entries: StoredPasswordEntry[],
  pageUrl: string,
  visible: boolean,
  enabled: boolean,
): StoredPasswordEntry | null {
  if (!visible || !enabled) return null;
  const matches = matchingPasswords(entries, pageUrl);
  return matches.length === 1 ? matches[0] ?? null : null;
}

/**
 * 此函数序列化后只在 WebContents 主帧执行。明文直接进入站点现有登录表单，
 * 不写 DOM 属性或日志，也不会自动提交。导航和 origin 在页面内再次校验。
 */
function fillLoginForm(payload: FillPayload): boolean {
  if (
    window.top !== window ||
    location.protocol !== "https:" ||
    location.origin !== payload.origin ||
    location.href !== payload.expectedUrl
  ) return false;

  const visible = (input: HTMLInputElement): boolean => {
    if (input.disabled || input.readOnly || input.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(input);
    return style.display !== "none" && style.visibility !== "hidden";
  };
  const passwordFields = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="password"]'))
    .filter((input) => visible(input) && input.autocomplete.toLowerCase() !== "new-password");
  // 多个密码框常见于注册/改密页；不能猜哪个是登录框。
  if (passwordFields.length !== 1) return false;
  const passwordField = passwordFields[0];
  if (!passwordField || passwordField.value) return false;

  const container: ParentNode = passwordField.form ?? document;
  const usernameFields = Array.from(container.querySelectorAll<HTMLInputElement>(
    'input[autocomplete="username"], input[type="email"], input[name*="user" i], input[name*="email" i], input[id*="user" i], input[id*="email" i]',
  )).filter((input) => visible(input) && input.type !== "password");
  const usernameField = usernameFields[0];
  if (usernameField?.value && usernameField.value !== payload.username) return false;

  const setValue = (input: HTMLInputElement, value: string): void => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };
  if (usernameField && !usernameField.value) setValue(usernameField, payload.username);
  setValue(passwordField, payload.password);
  return true;
}

export function fillPasswordScript(payload: FillPayload): string {
  return `(${fillLoginForm.toString()})(${JSON.stringify(payload)})`;
}
