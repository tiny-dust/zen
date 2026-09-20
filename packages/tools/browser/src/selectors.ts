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
      pageTitle: document.title
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
