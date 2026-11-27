import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import { useSettingsStore } from "./settings";

import type { AppSettings, CustomTheme } from "@zen/shared";

const THEME: CustomTheme = {
  id: "abc12345",
  name: { zh: "暖夜", en: "Warm night" },
  base: "dark",
  seeds: { accent: "#e98a4f", background: "#1d1512", surface: "#271c17", text: "#f6ece4" },
};

function base(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    shortcuts: [],
    updateFeedUrl: null,
    codeTheme: "github",
    theme: "light",
    customThemes: [],
    accentColor: "nomi",
    themeImage: { id: "", enabled: false, blur: 0, dim: 0.45 },
    locale: "zh-CN",
    displayAccount: "auto",
    planModel: null,
    actModel: null,
    ...overrides,
  };
}

/** 只实现本测试用到的 settings.set：把入参合并回内存并原样返回 */
function stubZen(initial: AppSettings, pack?: { pack?: CustomTheme }) {
  let state = initial;
  (window as unknown as { zen: unknown }).zen = {
    settings: {
      get: async () => state,
      set: async (partial: Partial<AppSettings>) => {
        state = { ...state, ...partial } as AppSettings;
        return state;
      },
      onChanged: () => () => undefined,
    },
    themePack: {
      import: async () => (pack?.pack ? { ok: true, pack: { ...pack.pack, id: undefined } } : { ok: false, error: "pack-invalid" }),
      export: async () => ({ ok: true }),
    },
  };
  return () => state;
}

describe("自定义主题 store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("删除当前正在用的主题时先退回预设", async () => {
    const read = stubZen(base({ theme: "custom:abc12345", customThemes: [THEME] }));
    const store = useSettingsStore();
    await store.bootstrap();
    await store.deleteCustomTheme("abc12345");

    const state = read();
    expect(state.customThemes).toHaveLength(0);
    expect(state.theme).toBe("light");
  });

  it("删除非当前主题不动主题选择", async () => {
    const read = stubZen(base({ theme: "dark", customThemes: [THEME] }));
    const store = useSettingsStore();
    await store.bootstrap();
    await store.deleteCustomTheme("abc12345");

    const state = read();
    expect(state.customThemes).toHaveLength(0);
    expect(state.theme).toBe("dark");
  });

  it("导入主题包会给新主题分配独立 id 并保存", async () => {
    const read = stubZen(base(), { pack: { ...THEME, id: undefined } as unknown as CustomTheme });
    const store = useSettingsStore();
    await store.bootstrap();

    const result = await store.importThemePack();
    expect(result.ok).toBe(true);
    const saved = read().customThemes;
    expect(saved).toHaveLength(1);
    expect(saved[0]?.id).not.toBe("abc12345");
    expect(saved[0]?.seeds.accent).toBe("#e98a4f");
  });

  it("非法主题包不写入任何东西", async () => {
    const read = stubZen(base());
    const store = useSettingsStore();
    await store.bootstrap();

    const result = await store.importThemePack();
    expect(result.ok).toBe(false);
    expect(read().customThemes).toHaveLength(0);
  });
});

describe("图片替换事务", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("保存失败时清掉新文件并恢复原设置", async () => {
    const cleared: string[] = [];
    let failSave = true;
    const initial = base({ themeImage: { id: "aaaaaaaaaaaa.png", enabled: true, blur: 0, dim: 0.4 } });
    let state = initial;
    (window as unknown as { zen: unknown }).zen = {
      settings: {
        get: async () => state,
        set: async (partial: Partial<AppSettings>) => {
          if (failSave) throw new Error("disk full");
          state = { ...state, ...partial } as AppSettings;
          return state;
        },
        onChanged: () => () => undefined,
      },
      themeImage: {
        pick: async () => ({ ok: true, id: "bbbbbbbbbbbb.png" }),
        read: async () => ({ ok: true, dataUrl: "data:image/png;base64,BBBB" }),
        clear: async (id: string) => {
          cleared.push(id);
          return { ok: true };
        },
        exists: async () => true,
      },
    };
    const store = useSettingsStore();
    await store.bootstrap();

    await store.pickThemeImage();

    expect(cleared).toEqual(["bbbbbbbbbbbb.png"]);
    expect(store.settings.themeImage.id).toBe("aaaaaaaaaaaa.png");
    expect(store.themeImageError).toBe("pick-failed");
  });

  it("慢返回的旧读图结果不会覆盖新选择", async () => {
    const pending = new Map<string, (value: { ok: boolean; dataUrl?: string }) => void>();
    let state = base({ themeImage: { id: "aaaa1111aaaa.png", enabled: true, blur: 0, dim: 0.4 } });
    (window as unknown as { zen: unknown }).zen = {
      settings: {
        get: async () => state,
        set: async (partial: Partial<AppSettings>) => {
          state = { ...state, ...partial } as AppSettings;
          return state;
        },
        onChanged: () => () => undefined,
      },
      themeImage: {
        pick: async () => ({ ok: true, id: "bbbb2222bbbb.png" }),
        read: (id: string) =>
          new Promise((resolve) => {
            pending.set(id, resolve);
          }),
        clear: async () => ({ ok: true }),
        exists: async () => true,
      },
    };
    const store = useSettingsStore();
    await store.bootstrap();

    // 先发旧图请求，再改引用并发新图请求；旧的最后才回来
    const first = store.loadThemeImage();
    store.settings = { ...store.settings, themeImage: { ...store.settings.themeImage, id: "bbbb2222bbbb.png" } };
    const second = store.loadThemeImage();

    pending.get("bbbb2222bbbb.png")?.({ ok: true, dataUrl: "data:image/png;base64,NEW" });
    await second;
    pending.get("aaaa1111aaaa.png")?.({ ok: true, dataUrl: "data:image/png;base64,OLD" });
    await first;

    expect(store.themeImageUrl).toBe("data:image/png;base64,NEW");
  });

});
