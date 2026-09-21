import { describe, expect, it } from "vitest";

import {
  LOCAL_IMAGE_MARKER,
  localPathFromMarker,
  responseParserOptions,
} from "./local-file-links";

type Rule = (state: unknown, silent: boolean) => boolean;

/**
 * markdown-it 探针：getRules 返回原始 link/image 规则，at() 记录插件注册的替换规则。
 * 手动调用替换规则即可复现「替换闭包内 normalizeLink 被临时换掉」的真实行为。
 */
function installPlugin() {
  const log: string[] = [];
  const replacements: Record<string, Rule> = {};

  const originalLink: Rule = function link() {
    log.push(`link:${(plugin as { normalizeLink: (u: string) => string }).normalizeLink("file:///Users/demo/doc.md")}`);
    return true;
  };
  const originalImage: Rule = function image() {
    log.push(`image:${(plugin as { normalizeLink: (u: string) => string }).normalizeLink("shot.png")}`);
    log.push(`image:${(plugin as { normalizeLink: (u: string) => string }).normalizeLink("/abs/demo.png")}`);
    log.push(`image:${(plugin as { normalizeLink: (u: string) => string }).normalizeLink("https://example.com/a.png")}`);
    return true;
  };

  const plugin = {
    normalizeLink: (url: string) => url,
    inline: {
      ruler: {
        getRules: () => [originalLink, originalImage],
        at(name: string, replacement: Rule) {
          replacements[name] = replacement;
        },
      },
    },
  };

  const install = responseParserOptions.plugins?.[0]?.markdownItPlugins?.[0];
  (install as (p: unknown) => void)(plugin);
  return { log, replacements };
}

describe("responseParserOptions 本地图片标记", () => {
  it("image 规则把本地引用改写为 data:image 标记，远程地址保持原样", () => {
    const { log, replacements } = installPlugin();
    replacements.image?.({}, false);
    expect(log[0]).toBe(`image:${LOCAL_IMAGE_MARKER}${encodeURIComponent("shot.png")}`);
    expect(log[1]).toBe(`image:${LOCAL_IMAGE_MARKER}${encodeURIComponent("/abs/demo.png")}`);
    expect(log[2]).toBe("image:https://example.com/a.png");
  });

  it("link 规则仍把 file:// 链接归一化为本地路径", () => {
    const { log, replacements } = installPlugin();
    replacements.link?.({}, false);
    expect(log[0]).toBe("link:/Users/demo/doc.md");
  });

  it("标记前缀是 data:image（harden 放行）且可反解", () => {
    expect(LOCAL_IMAGE_MARKER.startsWith("data:image/")).toBe(true);
    const marker = `${LOCAL_IMAGE_MARKER}${encodeURIComponent("/tmp/演示 空格.png")}`;
    expect(localPathFromMarker(marker)).toBe("/tmp/演示 空格.png");
    expect(localPathFromMarker("https://example.com/a.png")).toBeNull();
    expect(localPathFromMarker(undefined)).toBeNull();
  });
});
