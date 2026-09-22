import { BrowserWindow, dialog } from "electron";

import type { OpenDialogOptions, OpenDialogReturnValue } from "electron";

import { getBrowserService } from "./browser/service";

/**
 * 系统文件弹窗的安全封装：内嵌浏览器（WebContentsView）挂在 contentView 上，
 * 层级高于窗口内的系统弹窗（macOS sheet 尤其明显），会整个遮住弹窗。
 * 弹窗显示期间压制浏览器视图，关闭后恢复。
 */
export async function showOpenDialogSafe(
  parent: BrowserWindow | null,
  options: OpenDialogOptions,
): Promise<OpenDialogReturnValue> {
  const { hideForDialog } = getBrowserService();
  const restore = hideForDialog();
  try {
    return parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
  } finally {
    restore();
  }
}
