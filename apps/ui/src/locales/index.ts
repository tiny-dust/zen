import { createI18n } from "vue-i18n";

import { DEFAULT_LOCALE } from "@zen/shared";

import type { AppLocale } from "@zen/shared";
import type { VueMessageType } from "vue-i18n";
import type { WritableComputedRef } from "vue";

/** 模块语言包结构：modules/<ns>.ts 导出 { "zh-CN": {...}, "en-US": {...} } */
export type LocaleModule = Partial<Record<AppLocale, Record<string, unknown>>>;

const moduleFiles = import.meta.glob("./modules/*.ts", { eager: true }) as Record<
  string,
  { default: LocaleModule }
>;

/** vue-i18n v11 未导出 LocaleMessage，取其等价的递归消息类型 */
interface Messages {
  [key: string]: VueMessageType | Messages;
}

/** 文件名即命名空间（modules/sidebar.ts → t("sidebar.*")），各模块互不冲突、可并行维护 */
function buildMessages(locale: AppLocale): Messages {
  const messages: Messages = {};
  for (const [path, mod] of Object.entries(moduleFiles)) {
    const ns = path.split("/").pop()?.replace(/\.ts$/, "") ?? "";
    if (ns) {
      messages[ns] = (mod.default[locale] ?? {}) as Messages;
    }
  }
  return messages;
}

export const i18n = createI18n({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: "zh-CN",
  messages: {
    "zh-CN": buildMessages("zh-CN"),
    "en-US": buildMessages("en-US"),
  },
});

/** 切换界面语言（设置页调用；同步 <html lang> 供库与辅助技术识别） */
export function setAppLocale(locale: AppLocale) {
  (i18n.global.locale as WritableComputedRef<AppLocale>).value = locale;
  document.documentElement.lang = locale;
}
