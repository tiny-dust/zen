import { BrowserWindow } from "electron";
import { join } from "node:path";

import type { BrowserStatus } from "@zen/shared";

import { saveBrowserSettings } from "../zen-dir";
import { BrowserContentApi } from "./browser-content";

/**
 * 画中画悬浮窗：把内嵌浏览器 WebContentsView 从主窗口迁到 frameless / alwaysOnTop 小窗。
 * 三种模式（pipMode）：
 * - off      视图挂在主窗口右栏（默认）
 * - floating 视图挂在悬浮窗，浮在所有窗口上方，可拖动 / 缩放
 * - hidden   悬浮窗已关、页面在后台继续运行（面板不接管，可从面板再切回画中画）
 * 页面 webContents 全程不销毁，切换只是「搬 view」。
 */
export class BrowserPipApi extends BrowserContentApi {
  /** 进入画中画：off/hidden → floating */
  async enterPip(): Promise<BrowserStatus> {
    const status = await this.ensureRunning();
    if (status.state !== "running" || !this.view) {
      return status;
    }
    if (this.pipMode === "floating") {
      // 已在悬浮：只聚焦
      if (this.pipWindow && !this.pipWindow.isDestroyed()) {
        this.pipWindow.show();
        this.pipWindow.focus();
      }
      return this.getStatus();
    }
    const view = this.view;
    // 从主窗口摘下（页面不销毁），再挂到悬浮窗
    try {
      const host = this.hostWindow && !this.hostWindow.isDestroyed() ? this.hostWindow : null;
      host?.contentView?.removeChildView(view);
    } catch {
      // ignore
    }
    const pip = this.createPipWindow();
    this.pipWindow = pip;
    this.pipMode = "floating";
    pip.contentView.addChildView(view);
    this.wantVisible = true;
    pip.show();
    pip.focus();
    this.applyBounds();
    return this.getStatus();
  }

  /** 返回面板：floating → 视图重挂主窗口；hidden → 仅清后台标记，等面板 bounds 推送接管 */
  async exitPip(): Promise<BrowserStatus> {
    if (this.pipMode === "hidden") {
      this.pipMode = "off";
      // 不立即点亮：面板是否可见由渲染层说了算，bounds 推送到位后自然贴合
      this.wantVisible = false;
      this.applyBounds();
      return this.getStatus();
    }
    if (this.pipMode !== "floating") {
      return this.getStatus();
    }
    const view = this.view;
    this.destroyPipWindow();
    this.pipMode = "off";
    if (view && !view.webContents.isDestroyed()) {
      // 复用面板 attach 逻辑：hostWindow 缺失时回退到现存窗口（macOS 关窗后 activate 重建场景）
      const fallback = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed()) ?? null;
      const win = this.hostWindow && !this.hostWindow.isDestroyed() ? this.hostWindow : fallback;
      if (win) {
        this.hostWindow = win;
        try {
          win.contentView.addChildView(view);
        } catch {
          // ignore
        }
      }
    }
    // 先按缓存 bounds 兜底贴一次；渲染层收到 status 后会按面板矩形重新推送
    this.applyBounds();
    return this.getStatus();
  }

  /** 关闭悬浮窗（顶栏「关闭」按钮）：floating → hidden，页面后台运行 */
  async hidePip(): Promise<BrowserStatus> {
    if (this.pipMode !== "floating") {
      return this.getStatus();
    }
    const view = this.view;
    this.destroyPipWindow();
    this.pipMode = "hidden";
    this.wantVisible = false;
    try {
      view?.setVisible(false);
    } catch {
      // ignore
    }
    this.applyBounds();
    return this.getStatus();
  }

  /** 创建 frameless / alwaysOnTop 悬浮窗，顶栏为内联 HTML（复用主 preload 暴露的 IPC） */
  private createPipWindow(): BrowserWindow {
    const stored = this.settings.pipBounds;
    const pip = new BrowserWindow({
      width: stored?.width ?? 480,
      height: stored?.height ?? 300,
      x: stored?.x,
      y: stored?.y,
      minWidth: 280,
      minHeight: 180,
      frame: false,
      show: false,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: "#181818",
      title: "Zen 画中画",
      webPreferences: {
        // 复用主窗口 preload：顶栏按钮经 window.zen.browser.pipExit/pipHide 走既有 IPC 通道
        preload: join(__dirname, "../preload/index.js"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    // floating 层级：macOS 浮在普通窗口上方，Windows/Linux 同样生效（非平台专属 API）
    pip.setAlwaysOnTop(true, "floating");
    pip.setMenuBarVisibility(false);
    // 拖动 / 缩放时让视图重新贴齐顶栏下方
    pip.on("resize", () => this.applyBounds());
    // 非受控关闭（系统强杀窗口等）：页面转入后台运行而不是销毁
    pip.on("closed", () => {
      if (this.pipWindow === pip) {
        this.pipWindow = null;
        this.pipMode = "hidden";
        this.wantVisible = false;
        this.applyBounds();
      }
    });
    void pip
      .loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PIP_TOPBAR_HTML)}`)
      .catch(() => undefined);
    return pip;
  }

  /** 关闭并销毁悬浮窗；关闭前记住几何（含位置），下次进入画中画还原 */
  protected destroyPipWindow(): void {
    const pip = this.pipWindow;
    this.pipWindow = null;
    if (!pip || pip.isDestroyed()) {
      return;
    }
    try {
      const size = pip.getContentSize();
      const pos = pip.getPosition();
      // noUncheckedIndexedAccess：索引访问可能 undefined，钳制兜底
      const width = Number(size[0]) || 480;
      const height = Number(size[1]) || 300;
      void saveBrowserSettings({
        pipBounds: { x: Number(pos[0]) || 0, y: Number(pos[1]) || 0, width, height },
      }).catch(() => undefined);
    } catch {
      // ignore
    }
    try {
      pip.destroy();
    } catch {
      // ignore
    }
  }
}

/** 顶栏 UI：左侧「返回面板」、右侧「关闭」，整条为拖动区（-webkit-app-region 三平台通用）。
 * 颜色与主窗口暗色主题（--color-bg/--color-line）保持一致的硬编码值：data URL 页面拿不到 UI token。 */
const PIP_TOPBAR_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;height:100%;background:#181818;overflow:hidden;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
#bar{height:32px;display:flex;align-items:center;padding:0 4px;box-sizing:border-box;-webkit-app-region:drag;background:#181818;border-bottom:1px solid #2a2a2a}
#spacer{flex:1;height:100%}
button{all:unset;cursor:pointer;padding:0 8px;height:22px;line-height:22px;border-radius:4px;font-size:11px;color:#d4d4d8}
button:hover{background:#2e2e2e;color:#fff}
</style></head><body><div id="bar">
<button id="back" title="返回浏览器面板">返回面板</button>
<div id="spacer"></div>
<button id="close" title="关闭悬浮窗，页面转入后台运行">关闭</button>
</div><script>
document.getElementById("back").addEventListener("click", function () { window.zen.browser.pipExit(); });
document.getElementById("close").addEventListener("click", function () { window.zen.browser.pipHide(); });
</script></body></html>`;
