import { autoFillPasswordForPage, fillPasswordScript, securePageOrigin } from "./autofill";
import { BrowserPipApi } from "./browser-pip";
import { withTimeout } from "./browser-utils";
import { listStoredPasswords, revealPassword } from "./passwords";

/** 加密密码库到内嵌浏览器主帧的边界；自动填充只处理可见 HTTPS 页面。 */
export class BrowserAutofillApi extends BrowserPipApi {
  private autoFillAttemptKey = "";

  constructor() {
    super();
    // UI 可能先导航再展开面板；只在页面实际可见时才把凭据送入站点。
    this.onStatus((status) => {
      if (status.visible) this.maybeAutoFillVisiblePage();
    });
  }

  protected override onMainFrameLoaded(wc: Electron.WebContents): void {
    if (this.view?.webContents !== wc) return;
    this.autoFillAttemptKey = "";
    this.maybeAutoFillVisiblePage();
  }

  private maybeAutoFillVisiblePage(): void {
    if (!this.state.visible || !this.settings.autoFillPasswords) return;
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return;
    const pageUrl = wc.getURL();
    const key = `${wc.id}:${pageUrl}`;
    if (this.autoFillAttemptKey === key) return;
    const match = autoFillPasswordForPage(
      listStoredPasswords(), pageUrl, this.state.visible, this.settings.autoFillPasswords,
    );
    // 多条凭据必须由用户在密码列表选择；不猜账户。
    if (!match) return;
    this.autoFillAttemptKey = key;
    const entryId = match.id;
    void this.fillPasswordInPage(entryId, wc, pageUrl).then((result) => {
      if (result.filled || this.autoFillAttemptKey !== key) return;
      // SPA 登录框可能稍晚挂载；只对同一可见文档再尝试一次。
      setTimeout(() => {
        if (this.state.visible && this.autoFillAttemptKey === key) {
          void this.fillPasswordInPage(entryId, wc, pageUrl);
        }
      }, 800);
    });
  }

  /** 用户从密码库选择一条凭据后填入当前站点；不会提交表单。 */
  async fillPassword(id: string): Promise<{ ok: boolean; filled?: boolean; error?: string }> {
    const wc = this.view?.webContents;
    if (!wc || wc.isDestroyed()) return { ok: false, error: "内嵌浏览器未启动" };
    return this.fillPasswordInPage(id, wc, wc.getURL());
  }

  private async fillPasswordInPage(
    id: string,
    wc: Electron.WebContents,
    expectedUrl: string,
  ): Promise<{ ok: boolean; filled?: boolean; error?: string }> {
    const origin = securePageOrigin(expectedUrl);
    if (!origin) return { ok: false, error: "仅支持 HTTPS 站点填充密码" };
    const entry = listStoredPasswords().find((item) => item.id === id && item.origin === origin);
    if (!entry) return { ok: false, error: "当前站点没有匹配的密码" };
    const password = await revealPassword(id);
    if (password === null) return { ok: false, error: "密码解密失败" };
    if (
      wc.isDestroyed() || this.view?.webContents !== wc ||
      wc.getURL() !== expectedUrl || securePageOrigin(wc.getURL()) !== origin
    ) return { ok: false, error: "页面已切换，未填充密码" };

    try {
      const filled = await withTimeout(wc.mainFrame.executeJavaScript(fillPasswordScript({
        expectedUrl,
        origin,
        username: entry.username,
        password,
      })), 8_000, "密码填充");
      return filled === true
        ? { ok: true, filled: true }
        : { ok: false, filled: false, error: "当前页面没有可填充的登录表单" };
    } catch {
      return { ok: false, filled: false, error: "密码填充失败" };
    }
  }
}
