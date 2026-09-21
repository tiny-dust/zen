/** browser 域内共享的模块级小工具：内核标签、延时与超时包装。 */

export function kernelLabels(): { chromeVersion: string; electronVersion: string; kernelSource: string } {
  return {
    chromeVersion: process.versions.chrome || "",
    electronVersion: process.versions.electron || "",
    kernelSource: "Electron 内嵌 Chromium，随 Zen 应用 electron-updater 联网更新",
  };
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
