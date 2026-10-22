import type { BrowserElementRef } from "@zen/shared";

/** 把元素引用格式化进 composer / 系统提示，方便 AI 定位页面位置 */
export function formatElementForPrompt(ref: BrowserElementRef): string {
  const bits = [`selector=\`${ref.selector}\``, `tag=${ref.tag}`];
  if (ref.id) {
    bits.push(`id=${ref.id}`);
  }
  if (ref.text) {
    bits.push(`text="${ref.text}"`);
  }
  if (ref.ariaLabel) {
    bits.push(`aria-label="${ref.ariaLabel}"`);
  }
  if (ref.placeholder) {
    bits.push(`placeholder="${ref.placeholder}"`);
  }
  if (ref.role) {
    bits.push(`role=${ref.role}`);
  }
  if (ref.route) {
    bits.push(`route=${ref.route}`);
  }
  if (ref.domPath) {
    bits.push(`domPath=\`${ref.domPath}\``);
  }
  if (ref.sourceFiles?.length) {
    bits.push(`file=${ref.sourceFiles.join(",")}`);
  }
  bits.push(`rect=${ref.rect.width}x${ref.rect.height}@(${ref.rect.x},${ref.rect.y})`);
  bits.push(`page=${ref.pageUrl}`);
  return `[页面元素] ${bits.join(" ")}`;
}

/** 注入页面的拾取脚本源码（由 CDP Runtime.evaluate 执行） */
export const ELEMENT_PICK_SCRIPT = `(() => {
  if (window.__zenElementPickInstalled) { return "installed"; }
  window.__zenElementPickInstalled = true;
  const style = document.createElement("style");
  style.id = "zen-pick-style";
  style.textContent = \`
    #zen-pick-overlay{position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #ff6a2b;background:rgba(255,106,43,.12);box-sizing:border-box;display:none}
    #zen-pick-tip{position:fixed;z-index:2147483647;pointer-events:none;display:none;background:#181818;color:#f2f2f2;font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;padding:4px 8px;border-radius:6px;border:1px solid #333;max-width:360px;word-break:break-all}
  \`;
  document.documentElement.appendChild(style);
  const box = document.createElement("div");
  box.id = "zen-pick-overlay";
  document.documentElement.appendChild(box);
  const tip = document.createElement("div");
  tip.id = "zen-pick-tip";
  document.documentElement.appendChild(tip);

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return "";
    if (el.id && !/^\\d/.test(el.id)) return "#" + CSS.escape(el.id);
    const testId = el.getAttribute("data-testid") || el.getAttribute("data-test");
    if (testId) return '[data-testid="' + testId + '"]';
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 6) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(function(c){ return c.tagName === node.tagName; });
        if (siblings.length > 1) part += ":nth-of-type(" + (siblings.indexOf(node) + 1) + ")";
      }
      if (node.id && !/^\\d/.test(node.id)) {
        parts.unshift("#" + CSS.escape(node.id));
        break;
      }
      parts.unshift(part);
      node = parent;
      depth += 1;
    }
    return parts.join(" > ");
  }

  // 源码定位线索过滤：通用布局/状态类与 tailwind 风格工具类（p-4 / text-lg / hover:x 等）不算线索
  const GENERIC_CLASS_RE = /^(flex|grid|block|inline|hidden|container|wrapper|relative|absolute|fixed|sticky|active|open|selected|disabled)$/;
  const UTILITY_CLASS_RE = /^(p|m|w|h|min|max|text|bg|border|items|justify|gap|space|font|rounded|shadow|opacity|z|col|row|overflow|transition|duration|hover|focus|sm|md|lg|xl)-/;

  /** DOM 祖先链：最多 8 层，每层 tag + #id 或前 2 个类名，到 body 层停 */
  function domPathFor(el) {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 8) {
      let part = node.tagName.toLowerCase();
      if (node.id && !/^\\d/.test(node.id)) {
        part += "#" + node.id;
      } else {
        const cls = (node.getAttribute("class") || "").split(/\\s+/).filter(Boolean).slice(0, 2);
        if (cls.length) part += "." + cls.join(".");
      }
      parts.unshift(part);
      if (node === document.body) break;
      node = node.parentElement;
      depth += 1;
    }
    return parts.join(" > ");
  }

  /** 源码定位线索：自身 id / testid + 自身与 4 层祖先的语义类名，去重后最多 16 条 */
  function sourceHintsFor(el) {
    const hints = [];
    const seen = {};
    function push(value) {
      if (!value || value.length > 60) return;
      const key = value.toLowerCase();
      if (seen[key]) return;
      seen[key] = true;
      hints.push(value);
    }
    if (el.id && !/^\\d/.test(el.id)) push(el.id);
    const testId = el.getAttribute("data-testid") || el.getAttribute("data-test");
    if (testId) push(testId);
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      const raw = (node.getAttribute("class") || "").split(/\\s+/);
      for (const cls of raw) {
        if (!cls || cls.length < 4) continue;
        if (cls.indexOf("data-v-") === 0) continue;
        if (GENERIC_CLASS_RE.test(cls) || UTILITY_CLASS_RE.test(cls)) continue;
        push(cls);
      }
      node = node.parentElement;
      depth += 1;
    }
    return hints.slice(0, 16);
  }

  function describe(el) {
    const rect = el.getBoundingClientRect();
    const text = (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 120);
    const selector = selectorFor(el);
    const candidates = [selector];
    if (el.id) candidates.push("#" + CSS.escape(el.id));
    const name = el.getAttribute("name") || "";
    if (name) candidates.push(el.tagName.toLowerCase() + '[name="' + name + '"]');
    return {
      selector: selector,
      selectorCandidates: candidates.filter(function(v, i, a){ return a.indexOf(v) === i; }),
      tag: el.tagName.toLowerCase(),
      id: el.id || "",
      className: (el.getAttribute("class") || "").slice(0, 160),
      text: text,
      name: name,
      type: el.getAttribute("type") || "",
      placeholder: el.getAttribute("placeholder") || "",
      ariaLabel: el.getAttribute("aria-label") || "",
      role: el.getAttribute("role") || "",
      href: el.getAttribute("href") || "",
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      pageUrl: location.href,
      pageTitle: document.title,
      route: location.pathname + location.hash,
      domPath: domPathFor(el),
      sourceHints: sourceHintsFor(el)
    };
  }

  function highlight(el) {
    const rect = el.getBoundingClientRect();
    box.style.display = "block";
    box.style.left = rect.left + "px";
    box.style.top = rect.top + "px";
    box.style.width = rect.width + "px";
    box.style.height = rect.height + "px";
    tip.style.display = "block";
    tip.style.left = Math.min(window.innerWidth - 200, Math.max(8, rect.left)) + "px";
    tip.style.top = Math.max(8, rect.top - 28) + "px";
    tip.textContent = describe(el).selector;
  }

  function onMove(event) {
    const el = event.target;
    if (!(el instanceof Element)) return;
    highlight(el);
  }

  function onClick(event) {
    event.preventDefault();
    event.stopPropagation();
    const el = event.target;
    if (!(el instanceof Element)) return;
    const payload = describe(el);
    cleanup();
    if (typeof window.zenElementPicked === "function") {
      window.zenElementPicked(JSON.stringify(payload));
    }
  }

  function onKey(event) {
    if (event.key === "Escape") {
      cleanup();
    }
  }

  function cleanup() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    box.remove();
    tip.remove();
    style.remove();
    window.__zenElementPickInstalled = false;
    window.__zenElementPickCleanup = null;
    document.documentElement.style.cursor = "";
  }

  window.__zenElementPickCleanup = cleanup;
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("keydown", onKey, true);
  document.documentElement.style.cursor = "crosshair";
  return "started";
})()`;

export const ELEMENT_PICK_TEARDOWN = `(() => {
  if (typeof window.__zenElementPickCleanup === "function") {
    window.__zenElementPickCleanup();
  }
  return "ok";
})()`;
