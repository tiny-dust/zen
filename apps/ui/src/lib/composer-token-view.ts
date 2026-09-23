// ComposerEditor 的 token/装饰 DOM 构建：按分段把源文本装饰成节点。
// 通过 createTokenView 工厂创建，每个编辑器实例持有一份独立的 token 视图状态
// （已挂载的 Vue 子视图容器、悬浮明细 tooltip），随实例销毁。

import { h, render as renderVue } from "vue";
import { Globe, Sparkles } from "@lucide/vue";

import FileLabel from "@/components/files/FileLabel.vue";
import { formatElementDetail } from "@/lib/browser-element";

import type { ComposerAttachment } from "@/stores/chat-types";
import type { ComposerElementMark } from "@/lib/browser-element";
import type { Segment } from "@/lib/composer-segments";

/** 工厂依赖：token 悬浮时回报引用 id（attachmentId 或元素 id），离开回报 null；getter 供渲染时反查 */
export interface TokenViewHost {
  onTokenHover: (id: string | null) => void;
  attachments: () => ComposerAttachment[];
  elements: () => ComposerElementMark[] | undefined;
}

export interface TokenView {
  /** 按分段构建装饰节点 */
  renderSegments: (segments: Segment[]) => Node[];
  /** 卸载所有已挂载的 Vue 子视图（重渲染前 / 组件销毁时调用） */
  unmountTokenViews: () => void;
  /** 隐藏并移除悬浮明细 tooltip（组件销毁时调用） */
  disposeTooltip: () => void;
}

export function createTokenView(host: TokenViewHost): TokenView {
  const vueContainers: HTMLElement[] = [];

  function unmountTokenViews(): void {
    for (const container of vueContainers) {
      renderVue(null, container);
    }
    vueContainers.length = 0;
  }

  // ---------- 节点构建（手动建节点，scoped 样式命中不了，用 composer- 前缀全局类） ----------

  function el(tag: string, className: string, text?: string): HTMLElement {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) {
      node.textContent = text;
    }
    return node;
  }

  function renderBold(text: string): HTMLElement {
    const wrapper = el("span", "composer-md-bold");
    wrapper.append(
      el("span", "composer-md-mark", "**"),
      el("span", "composer-md-bold-text", text.slice(2, -2)),
      el("span", "composer-md-mark", "**"),
    );
    return wrapper;
  }

  function renderLink(text: string): HTMLElement {
    const match = /^\[([^\]]+)\]\(([^()]*)\)$/.exec(text);
    if (!match || !match[1]) {
      return el("span", "composer-md-link-label", text);
    }
    const wrapper = el("span", "composer-md-link");
    wrapper.append(
      el("span", "composer-md-mark", "["),
      el("span", "composer-md-link-label", match[1]),
      el("span", "composer-md-mark", "]("),
      el("span", "composer-md-url", match[2] ?? ""),
      el("span", "composer-md-mark", ")"),
    );
    return wrapper;
  }

  /** 页面元素 tag：与技能同构 —— 地球 icon + 名称；源文本保留 `$el:名称` 供 Agent 展开 */
  function renderElementToken(mark: ComposerElementMark): HTMLElement {
    const token = el("span", "composer-token composer-token-skill composer-token-element");
    token.contentEditable = "false";
    token.dataset.elementId = mark.id;
    token.setAttribute("aria-label", `页面元素 ${mark.label}`);
    token.setAttribute("role", "button");
    token.tabIndex = -1;
    const icon = el("span", "composer-token-icon");
    renderVue(h(Globe, { size: 12, "aria-hidden": "true" }), icon);
    vueContainers.push(icon);
    // prefix 仅存在于 textContent（display:none），视觉上只有 icon + 名称
    token.append(
      el("span", "composer-token-prefix", "$el:"),
      icon,
      el("span", "composer-token-name", mark.label),
    );
    token.addEventListener("mouseenter", (event) => {
      host.onTokenHover(mark.id);
      showElementTooltip(token, mark);
    });
    token.addEventListener("mouseleave", () => {
      host.onTokenHover(null);
      hideElementTooltip();
    });
    return token;
  }

  /* ---------- 元素 tag 悬浮明细 ---------- */

  let tooltipEl: HTMLElement | null = null;
  let tooltipTimer: ReturnType<typeof setTimeout> | null = null;

  function ensureTooltipEl(): HTMLElement {
    if (tooltipEl && document.body.contains(tooltipEl)) {
      return tooltipEl;
    }
    tooltipEl = document.createElement("div");
    tooltipEl.className = "composer-el-tooltip";
    tooltipEl.setAttribute("role", "tooltip");
    document.body.appendChild(tooltipEl);
    return tooltipEl;
  }

  function showElementTooltip(token: HTMLElement, mark: ComposerElementMark) {
    if (tooltipTimer) {
      clearTimeout(tooltipTimer);
    }
    tooltipTimer = setTimeout(() => {
      const tip = ensureTooltipEl();
      const detail = formatElementDetail(mark.ref);
      tip.innerHTML = "";
      const title = document.createElement("div");
      title.className = "composer-el-tooltip-title";
      title.textContent = mark.label;
      tip.appendChild(title);
      for (const line of detail.split("\n")) {
        const row = document.createElement("div");
        row.className = "composer-el-tooltip-row";
        row.textContent = line;
        tip.appendChild(row);
      }
      tip.style.display = "block";
      const rect = token.getBoundingClientRect();
      const tipW = 280;
      let left = rect.left;
      let top = rect.bottom + 6;
      if (left + tipW > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - tipW - 8);
      }
      if (top + 140 > window.innerHeight) {
        top = Math.max(8, rect.top - 8 - 120);
      }
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
    }, 120);
  }

  function hideElementTooltip() {
    if (tooltipTimer) {
      clearTimeout(tooltipTimer);
      tooltipTimer = null;
    }
    if (tooltipEl) {
      tooltipEl.style.display = "none";
    }
  }

  function disposeTooltip(): void {
    hideElementTooltip();
    if (tooltipEl?.parentElement) {
      tooltipEl.parentElement.removeChild(tooltipEl);
    }
    tooltipEl = null;
  }

  function renderToken(segment: Segment): HTMLElement {
    const mark = (host.elements() ?? []).find(
      (item) => item.token === segment.text || item.id === segment.attachmentId,
    );
    if (mark) {
      return renderElementToken(mark);
    }

    const att = host.attachments().find((item) => item.id === segment.attachmentId);
    // 主体（源文本去前缀字符）；目录部分并入隐藏前缀，chip 仅展示 basename，
    // 隐藏字符仍计入 textContent，保证与源文本一致（光标偏移依赖它）
    const body = att?.name ?? segment.text.slice(1);
    const slash = body.lastIndexOf("/");
    const name = slash >= 0 && slash < body.length - 1 ? body.slice(slash + 1) : body;
    const prefixText = segment.text.slice(0, segment.text.length - name.length);
    const token = el("span", "composer-token composer-token-file");
    token.contentEditable = "false";
    if (segment.attachmentId) {
      token.dataset.attachmentId = segment.attachmentId;
    }
    const label = el("span", "composer-token-name");
    renderVue(
      h(FileLabel, {
        path: att?.path ?? body,
        name,
        kind: body.endsWith("/") ? "directory" : "file",
        variant: "link",
      }),
      label,
    );
    vueContainers.push(label);
    token.append(el("span", "composer-token-prefix", prefixText), label);
    token.addEventListener("mouseenter", () => host.onTokenHover(segment.attachmentId ?? null));
    token.addEventListener("mouseleave", () => host.onTokenHover(null));
    return token;
  }

  /** 前缀保留在 textContent 中，但不参与 token 的布局。 */
  function renderSkillToken(text: string): HTMLElement {
    const name = text.slice("/skill:".length);
    const token = el("span", "composer-token composer-token-skill");
    token.contentEditable = "false";
    token.title = `技能：${name}`;
    const icon = el("span", "composer-token-icon");
    renderVue(h(Sparkles, { size: 12, "aria-hidden": "true" }), icon);
    vueContainers.push(icon);
    token.append(
      el("span", "composer-token-prefix", "/skill:"),
      icon,
      el("span", "composer-token-name", name),
    );
    return token;
  }

  function renderSegments(segments: Segment[]): Node[] {
    return segments.map((segment) => {
      switch (segment.kind) {
        case "bold":
          return renderBold(segment.text);
        case "link":
          return renderLink(segment.text);
        case "marker":
          return el("span", "composer-md-marker", segment.text);
        case "token":
          return renderToken(segment);
        case "skill":
          return renderSkillToken(segment.text);
        default:
          return document.createTextNode(segment.text);
      }
    });
  }

  return {
    renderSegments,
    unmountTokenViews,
    disposeTooltip,
  };
}
