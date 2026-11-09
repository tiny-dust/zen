/** browser 域内共享的模块级小工具：内核标签、延时与超时包装。 */

export function kernelLabels(): { chromeVersion: string; electronVersion: string; kernelSource: string } {
  return {
    chromeVersion: process.versions.chrome || "",
    electronVersion: process.versions.electron || "",
    kernelSource: "Electron 内嵌 Chromium，随 Zen 应用 electron-updater 联网更新",
  };
}

/** 合成器只有在视图可见且尺寸非 0 时才有帧可截 */
export function canCaptureSurface(
  visible: boolean,
  bounds: { width: number; height: number } | null,
): boolean {
  return visible && !!bounds && bounds.width > 1 && bounds.height > 1;
}

/** 截图彻底失败时的可操作提示（底层 viz 错误附在末尾便于排查） */
export function screenshotFailureMessage(detail: string): string {
  return `截图失败：窗口可能被最小化或被其他窗口遮挡。请把 Zen 切到前台、确认浏览器面板已展开后重试${
    detail ? `（原始错误：${detail}）` : ""
  }`;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms）`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
