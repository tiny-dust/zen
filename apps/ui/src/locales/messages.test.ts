import { beforeEach, describe, expect, it } from "vitest";

import { i18n } from "@/locales";

/**
 * 语言包健康检查：
 * 1. zh-CN / en-US 消息树结构一致（缺 key 会直接露出键名）
 * 2. 每条消息都能通过 vue-i18n 编译（@ / { 等特殊字符必须转义，未转义会在运行期抛错）
 */

function flatten(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      keys.push(...flatten(value as Record<string, unknown>, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function messagesOf(locale: string): Record<string, unknown> {
  const all = i18n.global.messages.value as Record<string, Record<string, unknown>>;
  return all[locale] ?? {};
}

describe("locales/messages", () => {
  beforeEach(() => {
    i18n.global.locale.value = "zh-CN";
  });

  it("zh-CN 与 en-US 的键结构完全一致", () => {
    const zh = flatten(messagesOf("zh-CN")).sort();
    const en = flatten(messagesOf("en-US")).sort();
    expect(en).toEqual(zh);
  });

  it("所有 zh-CN 消息可被 vue-i18n 编译且不等于键名", () => {
    const zh = messagesOf("zh-CN");
    for (const key of flatten(zh)) {
      const rendered = i18n.global.t(key);
      expect(rendered, `key=${key}`).not.toEqual(key);
    }
  });

  it("所有 en-US 消息可被 vue-i18n 编译且不等于键名", () => {
    i18n.global.locale.value = "en-US";
    const en = messagesOf("en-US");
    for (const key of flatten(en)) {
      const rendered = i18n.global.t(key);
      expect(rendered, `key=${key}`).not.toEqual(key);
    }
  });
});
