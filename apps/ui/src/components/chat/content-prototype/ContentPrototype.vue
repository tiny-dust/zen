<script setup lang="ts">
// Three content treatments on one isolated review page; no application state is bootstrapped.
import { ArrowLeft, ArrowRight, Check, ChevronRight, Layers, LayoutList, Pause, Play, RotateCcw, Search, SlidersHorizontal } from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref } from "vue";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import ConversationPreview from "./ConversationPreview.vue";
import FormatSample from "./FormatSample.vue";
import { formats } from "./catalog";

const variants = [
  { id: "A", name: "当前呈现", summary: "直接使用现有 MessageBubble 与 Response，作为真实样式基线。", verdict: "过程密集、层级偏平；错误与结果不容易一眼定位。" },
  { id: "B", name: "语义分层", summary: "正文裸排，过程缩进；动作、目标、结果各归其位。", verdict: "推荐先落地。保留现有顺序，不要求重做会话模型。" },
  { id: "C", name: "阶段归组", summary: "检查过程合并成阶段，结论单独呈现。", verdict: "适合超长运行，但改变阅读顺序与折叠策略，暂不默认采用。" },
];
const initialVariant = new URLSearchParams(location.search).get("variant");
const variant = ref(variants.find((item) => item.id === initialVariant)?.id ?? "B");
const activeVariant = computed(() => variants.find((item) => item.id === variant.value) ?? variants[1]);
const view = ref("overview");
const group = ref("全部格式");
const search = ref("");
const support = ref("all");
const previewWidth = ref("full");
const stage = ref(5);
const playing = ref(false);
const selectedIds = ref(["type", "tools", "reasoning", "errors"]);
const copied = ref(false);
const copyError = ref("");
const main = ref<HTMLElement>();
let timer: ReturnType<typeof setInterval> | undefined;
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
const groups = computed(() => [...new Set(formats.map((item) => item.group))]);
const visibleFormats = computed(() => formats.filter((item) => {
  const matchGroup = group.value === "全部格式" || item.group === group.value;
  const matchSupport = support.value === "all" || item.support === support.value;
  const matchText = `${item.title} ${item.note} ${item.id}`.toLowerCase().includes(search.value.toLowerCase().trim());
  return matchGroup && matchSupport && matchText;
}));
const supportLabel = { existing: "已有基础", partial: "部分支持 / 待验证", proposal: "拟议能力" };
const changes = [
  { id: "type", title: "正文与标题", scope: "样式", detail: "统一正文 14px / 1.8 行高，分开段落与章节间距；标题不再通篇用绿色。", files: "styles.css · .md-content" },
  { id: "tools", title: "工具行与目标", scope: "样式 + 结构", detail: "固定动作列和状态列，目标保持清晰；结果展开阅读，避免长摘要挤成灰色横线。", files: "ToolCallRow.vue · ToolCallCard.vue" },
  { id: "reasoning", title: "思考与过程", scope: "样式 + 行为", detail: "用缩进区分次级过程；修正自动收起条件，结束状态与实时过程一致。", files: "MessageBubble.vue · Reasoning.vue" },
  { id: "errors", title: "失败与运行状态", scope: "结构 + 行为", detail: "失败保留文字原因，状态不能只靠颜色；避免已结束的步骤仍显示运行中。", files: "ToolCallRow.vue · ChatTimeline.vue · chat.ts" },
  { id: "groups", title: "阶段归组", scope: "待讨论", detail: "方案 C 需要阶段边界与折叠规则，先不改变时间顺序或隐藏已有信息。", files: "消息分段与时间线投影" },
  { id: "rich", title: "媒体与产物", scope: "待讨论", detail: "音视频、产物卡片和可应用差异需要独立数据约定，不作为这轮样式修改附带上线。", files: "共享类型与资源访问协议" },
];
const selectionSummary = computed(() => changes.filter((item) => selectedIds.value.includes(item.id)).map((item) => item.title));

function navigateView(next: string, nextGroup = "全部格式") {
  view.value = next;
  group.value = nextGroup;
  main.value?.scrollTo({ top: 0 });
}
function setVariant(id: string) {
  variant.value = id;
  const url = new URL(location.href);
  url.searchParams.set("variant", id);
  history.replaceState(null, "", url);
}
function cycleVariant(offset: number) {
  const index = variants.findIndex((item) => item.id === variant.value);
  const next = variants[(index + offset + variants.length) % variants.length];
  if (next) setVariant(next.id);
}
function onKey(event: KeyboardEvent) {
  if (view.value !== "overview" || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.target instanceof Element && event.target.closest("input, textarea, select, button, [role='combobox'], [contenteditable='true']")) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    event.preventDefault();
    cycleVariant(event.key === "ArrowLeft" ? -1 : 1);
  }
}
function stopReplay() {
  if (timer) clearInterval(timer);
  timer = undefined;
  playing.value = false;
}
function replay() {
  stopReplay();
  stage.value = 0;
  playing.value = true;
  timer = setInterval(() => {
    stage.value += 1;
    if (stage.value >= 5) stopReplay();
  }, 900);
}
function toggleSelection(id: string) {
  selectedIds.value = selectedIds.value.includes(id) ? selectedIds.value.filter((item) => item !== id) : [...selectedIds.value, id];
}
async function copySelection() {
  copyError.value = "";
  try {
    await navigator.clipboard.writeText(`Zen 内容区评审\n方案：${variant.value} ${activeVariant.value?.name}\n候选修改：${selectionSummary.value.join("、") || "暂不修改"}\n仅评审，未应用到正式聊天。`);
    copied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => { copied.value = false; }, 1800);
  } catch {
    copyError.value = "剪贴板不可用，可直接选择下方清单文本。";
  }
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => {
  stopReplay();
  if (copiedTimer) clearTimeout(copiedTimer);
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div class="review-app">
    <header class="review-header">
      <span class="review-brand">Zen<span class="brand-divider" />内容区设计评审</span>
      <span class="draft-status">评审稿<span>未应用到正式聊天</span></span>
    </header>
    <div class="review-layout">
      <aside class="review-nav" aria-label="评审导航">
        <nav class="primary-nav">
          <button :class="{ selected: view === 'overview' }" @click="navigateView('overview')"><Layers />整体对照</button>
          <button :class="{ selected: view === 'catalog' && group === '全部格式' }" @click="navigateView('catalog')"><LayoutList />全部格式<span>{{ formats.length }}</span></button>
          <button :class="{ selected: view === 'decisions' }" @click="navigateView('decisions')"><SlidersHorizontal />调整建议</button>
        </nav>
        <div class="nav-section-label">格式目录</div>
        <nav class="category-nav">
          <button v-for="category in groups" :key="category" :class="{ selected: view === 'catalog' && group === category }" @click="navigateView('catalog', category)">
            {{ category }}<span>{{ formats.filter((item) => item.group === category).length }}</span>
          </button>
        </nav>
        <div class="nav-footnote">所有执行、审批和终态均为演示数据。选择只用于评审，不会修改应用。</div>
      </aside>
      <main ref="main" class="review-main">
        <div class="main-heading">
          <div>
            <h1>{{ view === 'overview' ? '一眼分清，正在做什么。' : view === 'catalog' ? group : '先改哪些，暂缓哪些。' }}</h1>
            <p>{{ view === 'overview' ? '同一段内容，三种组织方式。先看效果，再定修改范围。' : view === 'catalog' ? '逐项查看实际内容格式；“已有基础”不代表当前样式已通过验收。' : '优先修复高频内容的可读性，新能力单独决定。' }}</p>
          </div>
          <span class="heading-meta">{{ view === 'catalog' ? `${visibleFormats.length} / ${formats.length} 项` : '内容样式评审' }}</span>
        </div>

        <template v-if="view === 'overview'">
          <nav class="variant-tabs" aria-label="设计方案">
            <button v-for="item in variants" :key="item.id" :aria-current="variant === item.id ? 'true' : undefined" :class="{ selected: variant === item.id }" @click="setVariant(item.id)">
              <span class="variant-key">{{ item.id }}</span>{{ item.name }}<span v-if="item.id === 'B'" class="recommended">推荐</span>
            </button>
          </nav>
          <div class="overview-columns">
            <section class="preview-area" aria-label="对话内容预览">
              <div class="preview-toolbar">
                <span>对话样例<span class="toolbar-separator">/</span>模拟数据</span>
                <div class="preview-actions">
                  <Select v-model="previewWidth">
                    <SelectTrigger class="width-select" aria-label="预览内容宽度"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectGroup><SelectItem value="full">正常宽度</SelectItem><SelectItem value="narrow">窄栏 420px</SelectItem></SelectGroup></SelectContent>
                  </Select>
                  <Button v-if="playing" variant="ghost" size="icon-sm" aria-label="暂停流式回放" title="暂停流式回放" @click="stopReplay"><Pause /></Button>
                  <Button v-else variant="ghost" size="icon-sm" aria-label="回放模拟流式输出" title="回放模拟流式输出" @click="replay"><Play /></Button>
                  <Button variant="ghost" size="icon-sm" aria-label="显示完整对话" title="显示完整对话" @click="stopReplay(); stage = 5"><RotateCcw /></Button>
                </div>
              </div>
              <div class="preview-canvas" :class="{ narrow: previewWidth === 'narrow' }">
                <ConversationPreview :key="variant" :variant="variant" :stage="stage" :playing="playing" />
              </div>
            </section>
            <aside class="review-notes">
              <h2>{{ activeVariant?.name }}</h2><p>{{ activeVariant?.summary }}</p>
              <p class="review-verdict">{{ activeVariant?.verdict }}</p>
              <h3>辨识度来自三层</h3>
              <dl><dt>结果</dt><dd>正文保持完整亮度，章节间距更清楚。</dd><dt>过程</dt><dd>缩进、固定列、次级字号，不靠整片变灰。</dd><dt>异常</dt><dd>状态图标 + 文字原因，不只在末尾放一个叉。</dd></dl>
              <h3>保留不动</h3><p>深色背板、助手无气泡、工具按时间顺序、正文流式随到随显。</p>
              <Button variant="outline" size="sm" @click="navigateView('catalog')">查看 {{ formats.length }} 种格式<ChevronRight data-icon="inline-end" /></Button>
            </aside>
          </div>
          <div class="prototype-switcher" aria-label="切换评审方案">
            <Button variant="ghost" size="icon-sm" aria-label="上一个方案" @click="cycleVariant(-1)"><ArrowLeft /></Button>
            <span>{{ variant }}<span>{{ activeVariant?.name }}</span></span>
            <Button variant="ghost" size="icon-sm" aria-label="下一个方案" @click="cycleVariant(1)"><ArrowRight /></Button>
          </div>
        </template>

        <template v-else-if="view === 'catalog'">
          <div class="catalog-controls">
            <div class="catalog-search"><Search /><Input v-model="search" aria-label="搜索输出格式" placeholder="搜索格式、状态或内容" /></div>
            <Select v-model="support"><SelectTrigger class="support-select" aria-label="按支持范围筛选"><SelectValue /></SelectTrigger><SelectContent><SelectGroup><SelectItem value="all">所有支持范围</SelectItem><SelectItem value="existing">已有基础</SelectItem><SelectItem value="partial">部分支持 / 待验证</SelectItem><SelectItem value="proposal">拟议能力</SelectItem></SelectGroup></SelectContent></Select>
          </div>
          <div class="catalog-legend"><span>样式使用 B 方案</span><span>Markdown 使用现有渲染器；其余为隔离交互样例。</span></div>
          <div class="format-list">
            <article v-for="format in visibleFormats" :id="`format-${format.id}`" :key="format.id" class="format-entry">
              <div class="format-description"><span class="format-group">{{ format.group }}</span><h2>{{ format.title }}</h2><span class="support-marker" :data-support="format.support">{{ supportLabel[format.support] }}</span><p>{{ format.note }}</p><details class="format-source"><summary>源码依据</summary><code>{{ format.source }}</code></details></div>
              <div class="format-stage proposal-content"><FormatSample :id="format.id" /></div>
            </article>
            <p v-if="!visibleFormats.length" class="empty-results">没有匹配的格式，请调整关键词或筛选范围。</p>
          </div>
        </template>

        <template v-else>
          <div class="decision-intro"><strong>建议先采用 B：语义分层</strong><p>先做排版与工具行；折叠、终态归属再分开验证。下面是候选范围，不是已经执行的变更。</p></div>
          <div class="decision-list">
            <article v-for="change in changes" :key="change.id" class="decision-row">
              <Button variant="outline" size="icon-sm" :aria-label="`${selectedIds.includes(change.id) ? '移除' : '选择'}${change.title}`" :aria-pressed="selectedIds.includes(change.id)" @click="toggleSelection(change.id)"><Check v-if="selectedIds.includes(change.id)" /></Button>
              <div><h2>{{ change.title }}<span>{{ change.scope }}</span></h2><p>{{ change.detail }}</p><code>{{ change.files }}</code></div>
            </article>
          </div>
          <section class="decision-summary" aria-label="候选修改清单"><h2>本次候选范围</h2><p>{{ selectionSummary.join('、') || '暂不修改' }}</p><Button size="sm" variant="outline" @click="copySelection">{{ copied ? '已复制评审意见' : '复制评审意见' }}</Button><p v-if="copyError" role="status">{{ copyError }}</p><p class="decision-disclaimer">仅本页内存状态。没有保存设置、执行工具或修改正式聊天。</p></section>
        </template>
      </main>
    </div>
  </div>
</template>

<style scoped>
.review-app { height: 100%; display: flex; flex-direction: column; color: var(--color-txt); background: var(--color-main-bg); letter-spacing: 0; user-select: text; }
.review-header { height: 56px; flex: none; display: flex; align-items: center; justify-content: space-between; padding: 0 24px; border-bottom: 1px solid var(--color-line); background: var(--color-side); }
.review-brand { display: flex; align-items: center; gap: 14px; font-size: 14px; font-weight: 600; }
.brand-divider { width: 1px; height: 14px; background: var(--color-btn-border); }
.draft-status { display: flex; align-items: center; gap: 12px; color: var(--color-mut); font-size: 12px; }
.draft-status > span { padding-left: 12px; border-left: 1px solid var(--color-line); }
.review-layout { min-height: 0; flex: 1; display: grid; grid-template-columns: 196px minmax(0, 1fr); }
.review-nav { display: flex; flex-direction: column; background: var(--color-side); padding: 24px 12px; gap: 24px; }
.primary-nav, .category-nav { display: flex; flex-direction: column; gap: 4px; }
.primary-nav button, .category-nav button { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: var(--radius-sm); color: var(--color-mut); font-size: 13px; min-height: 38px; }
.primary-nav button > svg { width: 16px; height: 16px; }
.primary-nav button > span, .category-nav button > span { margin-left: auto; font-size: 11px; color: var(--color-mut); }
.primary-nav button.selected, .category-nav button.selected { background: var(--color-side-sel); color: var(--color-txt-strong); }
.primary-nav button:hover, .category-nav button:hover { color: var(--color-txt-strong); }
.nav-section-label { padding: 0 12px; font-size: 11px; color: var(--color-mut); margin-bottom: -15px; }
.nav-footnote { margin-top: auto; padding: 12px; color: var(--color-mut); font-size: 11px; line-height: 1.8; }
.review-main { min-width: 0; overflow: auto; padding: 36px 42px 88px; }
.main-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; max-width: 1280px; margin: 0 auto 28px; }
.main-heading h1 { margin: 0 0 10px; font-size: 22px; line-height: 1.4; font-weight: 600; }
.main-heading p { margin: 0; color: var(--color-mut); font-size: 13px; line-height: 1.8; }
.heading-meta { color: var(--color-mut); font-size: 11px; white-space: nowrap; padding-top: 6px; }
.variant-tabs { max-width: 1280px; margin: 0 auto 22px; display: flex; gap: 24px; border-bottom: 1px solid var(--color-line); }
.variant-tabs button { display: flex; align-items: center; gap: 8px; min-height: 44px; margin-bottom: -1px; padding-bottom: 12px; border-bottom: 2px solid transparent; font-size: 13px; color: var(--color-mut); }
.variant-tabs button.selected { border-bottom-color: var(--color-txt-strong); color: var(--color-txt-strong); }
.variant-key { font-family: var(--font-mono); font-size: 11px; color: var(--color-mut); }
.recommended { color: var(--color-blue); font-size: 11px; }
.overview-columns { max-width: 1280px; margin: auto; display: grid; grid-template-columns: minmax(0, 1fr) 214px; gap: 34px; align-items: start; }
.preview-area { min-width: 0; }
.preview-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 10px; min-height: 38px; color: var(--color-mut); font-size: 11px; margin-bottom: 24px; }
.toolbar-separator { margin: 0 10px; color: var(--color-dim); }
.preview-actions { display: flex; align-items: center; gap: 2px; }
.width-select { width: 114px; height: 28px; font-size: 11px; }
.preview-canvas { container-type: inline-size; container-name: preview; width: 100%; max-width: 860px; margin: 0 auto; transition: max-width var(--motion-base); }
.preview-canvas.narrow { max-width: 420px; }
.review-notes { padding: 12px 0 0 22px; border-left: 1px solid var(--color-line); color: var(--color-mut); font-size: 12px; line-height: 1.8; }
.review-notes h2 { font-size: 14px; color: var(--color-txt-strong); font-weight: 600; margin: 0 0 10px; }
.review-notes h3 { font-size: 12px; color: var(--color-txt); margin: 26px 0 10px; font-weight: 600; }
.review-notes p { margin: 0 0 12px; }
.review-verdict { color: var(--color-txt); }
.review-notes dl { margin: 0; display: grid; grid-template-columns: 30px 1fr; gap: 10px 8px; }
.review-notes dt { color: var(--color-txt); }
.review-notes dd { margin: 0; }
.review-notes :deep(button) { margin-top: 12px; }
.prototype-switcher { position: fixed; bottom: 20px; left: calc(50% + 98px); transform: translateX(-50%); display: flex; align-items: center; gap: 10px; padding: 4px 8px; background: var(--color-composer-surface); border: 1px solid var(--color-btn-border); border-radius: var(--radius-sm); box-shadow: var(--shadow-menu); }
.prototype-switcher > span { display: flex; gap: 12px; align-items: center; font-size: 12px; min-width: 94px; justify-content: center; }
.prototype-switcher > span > span { color: var(--color-mut); }
.catalog-controls { display: flex; gap: 12px; max-width: 1280px; margin: 0 auto 12px; }
.catalog-search { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.catalog-search > svg { width: 16px; height: 16px; color: var(--color-mut); flex: none; }
.catalog-search :deep(input) { max-width: 440px; }
.support-select { width: 180px; flex: none; }
.catalog-legend { max-width: 1280px; margin: 0 auto 26px; font-size: 11px; color: var(--color-mut); display: flex; flex-wrap: wrap; gap: 8px 18px; }
.format-list { max-width: 1280px; margin: auto; }
.format-entry { display: grid; grid-template-columns: 214px minmax(0, 1fr); gap: 32px; padding: 30px 0; border-top: 1px solid var(--color-line); }
.format-description { min-width: 0; font-size: 12px; color: var(--color-mut); }
.format-description h2 { font-size: 16px; margin: 6px 0 10px; color: var(--color-txt-strong); font-weight: 600; }
.format-group { font-size: 11px; }
.support-marker { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; }
.support-marker::before { content: ''; width: 5px; height: 5px; border-radius: 50%; background: var(--color-mut); }
.support-marker[data-support='existing']::before { background: var(--color-add); }
.support-marker[data-support='partial']::before { background: var(--color-blue); }
.support-marker[data-support='proposal']::before { background: var(--color-accent-2); }
.format-description p { line-height: 1.8; margin: 10px 0; }
.format-source { font-size: 11px; }
.format-source summary { display: inline; color: var(--color-mut); }
.format-source code { display: block; font-size: 10px; overflow-wrap: anywhere; margin-top: 8px; }
.format-stage { min-width: 0; container-type: inline-size; container-name: sample; padding-top: 3px; }
.empty-results { padding: 50px 0; color: var(--color-mut); font-size: 13px; }
.decision-intro, .decision-list, .decision-summary { max-width: 860px; margin-inline: auto; }
.decision-intro { padding: 0 0 28px; }
.decision-intro strong { font-size: 16px; font-weight: 600; }
.decision-intro p { color: var(--color-mut); font-size: 13px; line-height: 1.8; margin: 8px 0 0; }
.decision-row { display: flex; gap: 16px; padding: 24px 0; border-top: 1px solid var(--color-line); }
.decision-row > div { min-width: 0; }
.decision-row h2 { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 0 0 7px; font-size: 14px; font-weight: 600; }
.decision-row h2 span { font-size: 11px; font-weight: 400; color: var(--color-mut); }
.decision-row p { margin: 0 0 10px; color: var(--color-mut); font-size: 13px; line-height: 1.8; }
.decision-row code { font-size: 11px; color: var(--color-mut); overflow-wrap: anywhere; }
.decision-summary { margin-top: 12px; padding-top: 24px; border-top: 1px solid var(--color-line); }
.decision-summary h2 { font-size: 14px; font-weight: 600; margin: 0; }
.decision-summary p { font-size: 13px; line-height: 1.8; }
.decision-disclaimer { color: var(--color-mut); font-size: 11px !important; }
.review-app :deep(button:focus-visible), .review-app summary:focus-visible { background-color: var(--color-menu-active); color: var(--color-txt-strong); }
/* Proposal overrides stay below this isolated page. Production markdown remains unchanged. */
.proposal-content :deep(.sample-prose) { font-size: 14px; line-height: 1.8; font-weight: 400; color: var(--color-txt); min-width: 0; overflow-wrap: anywhere; }
.proposal-content :deep(.sample-prose p) { margin-block: 0 12px; }
.proposal-content :deep(.sample-prose h1), .proposal-content :deep(.sample-prose h2), .proposal-content :deep(.sample-prose h3), .proposal-content :deep(.sample-prose h4), .proposal-content :deep(.sample-prose h5), .proposal-content :deep(.sample-prose h6) { color: var(--color-txt-strong); line-height: 1.45; font-weight: 600; margin-block: 26px 10px; }
.proposal-content :deep(.sample-prose h1) { font-size: 20px; }
.proposal-content :deep(.sample-prose h2) { font-size: 18px; }
.proposal-content :deep(.sample-prose h3) { font-size: 15px; margin-top: 22px; }
.proposal-content :deep(.sample-prose h4) { font-size: 14px; }
.proposal-content :deep(.sample-prose h5), .proposal-content :deep(.sample-prose h6) { font-size: 13px; color: var(--color-mut); }
.proposal-content :deep(.sample-prose ul), .proposal-content :deep(.sample-prose ol) { margin-block: 12px; padding-left: 22px; }
.proposal-content :deep(.sample-prose li) { margin-block: 6px; }
.proposal-content :deep(.sample-prose strong) { font-weight: 650; color: var(--color-txt-strong); }
.proposal-content :deep(.sample-prose a) { text-decoration: underline; text-underline-offset: 3px; text-decoration-color: color-mix(in srgb, var(--color-link) 45%, transparent); overflow-wrap: anywhere; }
.proposal-content :deep(.sample-prose blockquote) { margin-block: 18px; padding: 4px 0 4px 14px; border-left: 2px solid var(--color-blue); color: var(--color-mut); }
.proposal-content :deep(.sample-prose blockquote p:last-child) { margin-bottom: 0; }
.proposal-content :deep(.sample-prose code) { font-size: 12px; font-weight: 400; overflow-wrap: anywhere; word-break: break-word; white-space: pre-wrap; }
.proposal-content :deep(.sample-prose [data-stream-markdown='code-block']) { margin-block: 16px; background: var(--color-side); }
.proposal-content :deep(.sample-prose [data-stream-markdown='code-block'] .code-block-header) { min-height: 32px; padding-inline: 12px; }
.proposal-content :deep(.sample-prose [data-stream-markdown='code-block'] pre) { line-height: 1.7; padding: 12px 14px; }
.proposal-content :deep(.sample-prose table) { margin-block: 16px; font-size: 13px; }
.proposal-content :deep(.sample-prose th), .proposal-content :deep(.sample-prose td) { padding: 9px 12px; }
.proposal-content :deep(.sample-prose th) { background: var(--color-composer-surface); }
.proposal-content :deep(.sample-prose hr) { margin-block: 24px; }
@media (min-width: 1700px) { .review-main { padding-inline: 64px; } }
@media (max-width: 1160px) {
  .review-main { padding-inline: 28px; }
  .overview-columns { grid-template-columns: minmax(0, 1fr); }
  .review-notes { display: grid; grid-template-columns: 1fr 1fr; column-gap: 28px; padding: 24px 0; border-left: 0; border-top: 1px solid var(--color-line); }
  .review-notes h2, .review-notes .review-verdict { grid-column: 1 / -1; }
  .review-notes h3 { margin-top: 10px; }
  .format-entry { grid-template-columns: 180px minmax(0, 1fr); gap: 24px; }
}
@media (max-width: 780px) {
  .review-header { padding-inline: 16px; height: 48px; }
  .review-layout { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
  .review-nav { padding: 8px 12px; display: block; }
  .primary-nav { flex-direction: row; gap: 8px; }
  .primary-nav button { padding: 6px 10px; min-height: 32px; font-size: 12px; }
  .category-nav, .nav-section-label, .nav-footnote { display: none; }
  .draft-status > span, .heading-meta { display: none; }
  .review-main { padding: 24px 18px 84px; }
  .main-heading h1 { font-size: 20px; }
  .main-heading p { font-size: 12px; }
  .variant-tabs { gap: 20px; }
  .variant-tabs button { gap: 5px; font-size: 12px; }
  .recommended { font-size: 10px; }
  .prototype-switcher { left: 50%; bottom: 14px; }
  .format-entry { grid-template-columns: 1fr; gap: 18px; }
  .format-description p { max-width: 65ch; }
  .catalog-controls { flex-wrap: wrap; }
  .catalog-search { flex-basis: 100%; }
  .support-select { width: 100%; }
  .review-notes { display: block; }
  .review-notes h3 { margin-top: 20px; }
}
@media (max-width: 400px) { .review-brand { gap: 9px; font-size: 12px; } .draft-status { font-size: 10px; } .primary-nav { gap: 0; } .preview-toolbar { flex-wrap: wrap; } .variant-tabs { gap: 13px; } }
@media (prefers-reduced-motion: reduce) { .preview-canvas { transition: none; } }
</style>
