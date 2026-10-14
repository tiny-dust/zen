import { config } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach } from "vitest";

import { i18n } from "@/locales";

// 组件测试统一装 i18n 插件：默认 zh-CN，既有断言（中文文案）保持不变。
config.global.plugins = [i18n];

// ui 原语（Dialog/Popover 等 Content）内置 useOverlayGeometry → useBrowserStore：
// 每个测试换一个活跃 pinia，组件挂载未显式注入 pinia 时走 activePinia 回退，
// 也不与测试自建 pinia（setActivePinia/mount plugins）的用例互相串状态。
beforeEach(() => {
  setActivePinia(createPinia());
});
