import { Menu } from "electron";

/**
 * 应用菜单（三平台统一）：
 * - 不含 Reload / Force Reload 角色：整页刷新会丢渲染层状态（终端面板 PTY 会话断链），
 *   配合 createWindow 里的 before-input-event 拦截，彻底禁用 Cmd/Ctrl+R 与 F5；
 * - macOS 保留 appMenu / editMenu / windowMenu：复制粘贴等系统快捷键依赖菜单角色；
 * - Windows/Linux 菜单栏隐藏（autoHideMenuBar），仅保留角色快捷键；
 * - dev 构建保留手动重载与 DevTools，但改用 CmdOrCtrl+Alt+R，避免与生产一致的误触。
 */
export function setupApplicationMenu(isDev: boolean): void {
  const template: Electron.MenuItemConstructorOptions[] = [];
  if (process.platform === "darwin") {
    template.push({ role: "appMenu" });
  } else {
    template.push({ role: "fileMenu" });
  }
  template.push({ role: "editMenu" });
  if (isDev) {
    template.push({
      label: "View",
      submenu: [
        { role: "reload", accelerator: "CmdOrCtrl+Alt+R" },
        { role: "forceReload", accelerator: "CmdOrCtrl+Alt+Shift+R" },
        { role: "toggleDevTools" },
      ],
    });
  }
  if (process.platform === "darwin") {
    template.push({ role: "windowMenu" });
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
