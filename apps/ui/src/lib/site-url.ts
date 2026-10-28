/**
 * 站点 URL 小工具：浏览器历史 / 网络来源共用的主机名、首字母徽标与去重键。
 * 只做字符串归一，不发请求；解析失败一律安全回退，不抛错。
 */

/** 常见跟踪参数：同一页面被它们拖出多条历史记录，去重时忽略 */
const TRACKING_PARAMS = new Set(["gclid", "fbclid", "msclkid", "yclid", "igshid"]);

/** 从原串里粗取主机（含端口）：中文域名在 URL 解析后会被转成 punycode，展示时想保留原文 */
const RAW_HOST_RE = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/]*@)?([^/?#]+)/i;

/** 站点主机名：小写、去 www 前缀；解析失败回退原串 */
export function siteHost(url: string): string {
  const raw = (url || "").trim();
  if (!raw) {
    return "";
  }
  const rawHost = RAW_HOST_RE.exec(raw)?.[1]?.replace(/:\d+$/, "") ?? "";
  if (/[^\x00-\x7f]/.test(rawHost)) {
    return rawHost.replace(/^www\./i, "").toLowerCase();
  }
  try {
    return new URL(raw).host.replace(/^www\./i, "").toLowerCase();
  } catch {
    return raw;
  }
}

/** 站点首字母（卡片徽标用）：取主机名首个字母/汉字，找不到给 ? */
export function siteInitial(url: string): string {
  const host = siteHost(url).replace(/^[^a-z0-9\u4e00-\u9fa5]+/i, "");
  return (host.charAt(0) || "?").toUpperCase();
}

/** 站点源（协议 + 主机）：favicon 按站点取，同一站点只拉一次 */
export function siteOrigin(url: string): string {
  try {
    const parsed = new URL((url || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return `${parsed.protocol}//${parsed.host.toLowerCase()}`;
  } catch {
    return "";
  }
}

/**
 * 去重键：同一页面的不同写法合并成一条。
 * 规范化内容：去 hash、去尾斜杠、丢跟踪参数、忽略 http/https 与 www 差异、
 * 查询参数排序。路径/其它查询参数保留——不同页面仍然是不同条目。
 */
export function siteKey(url: string): string {
  const raw = (url || "").trim();
  if (!raw) {
    return "";
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return raw.toLowerCase();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return raw.toLowerCase();
  }
  const host = parsed.host.replace(/^www\./i, "").toLowerCase();
  const path = parsed.pathname.replace(/\/+$/, "");
  const params = [...parsed.searchParams.entries()]
    .filter(([name]) => {
      const key = name.toLowerCase();
      return !key.startsWith("utm_") && !TRACKING_PARAMS.has(key);
    })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  return `${host}${path}${params ? `?${params}` : ""}`;
}
