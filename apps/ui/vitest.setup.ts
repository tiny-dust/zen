import { config } from "@vue/test-utils";

import { i18n } from "@/locales";

// 组件测试统一装 i18n 插件：默认 zh-CN，既有断言（中文文案）保持不变
config.global.plugins = [i18n];
