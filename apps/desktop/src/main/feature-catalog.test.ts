import { describe, expect, it, vi } from "vitest";

// feature-catalog 顶部 import electron：只需 ipcMain.handle 存根（本测试不触发 IPC 注册）
vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

import { probeFeatures, registerFeatureProbe } from "./feature-catalog";

describe("probeFeatures", () => {
  it("probe 未注册的可选能力返回不可用（not-installed）", async () => {
    const result = await probeFeatures();
    expect(result.ok).toBe(true);
    expect(result.platform).toBe(process.platform);
    // 目录四件套（voice / tts / ocr / cua）：未接线 probe 时缺省 = 未安装
    expect(result.entries.map((item) => item.id).sort()).toEqual(["cua", "ocr", "tts", "voice"]);
    for (const entry of result.entries) {
      expect(entry.available).toBe(false);
      expect(entry.reason).toBe("not-installed");
    }
  });

  it("注册 probe 后目录亮起；probe 抛错按不可用处理", async () => {
    registerFeatureProbe("voice", () => true);
    registerFeatureProbe("tts", async () => true);
    registerFeatureProbe("ocr", () => {
      throw new Error("boom");
    });
    const result = await probeFeatures();
    const byId = new Map(result.entries.map((item) => [item.id, item]));
    expect(byId.get("voice")?.available).toBe(true);
    expect(byId.get("voice")?.reason).toBeUndefined();
    expect(byId.get("tts")?.available).toBe(true);
    expect(byId.get("ocr")?.available).toBe(false);
    expect(byId.get("ocr")?.reason).toBe("not-installed");
  });

  it("目录条目必须带使用说明（usage），渲染层据此展示如何使用", async () => {
    const result = await probeFeatures();
    for (const entry of result.entries) {
      expect(entry.usage.length).toBeGreaterThan(0);
    }
  });
});
