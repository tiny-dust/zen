<script setup lang="ts">
import {
  IconAlertTriangle as TriangleAlert,
  IconBrain as Brain,
  IconChevronDown as ChevronDown,
  IconChevronRight as ChevronRight,
  IconDownload as Download,
  IconLoader2 as Loader2,
  IconPlus as Plus,
  IconRefresh as RefreshCw,
  IconSparkles as Sparkles,
  IconX as X,
} from "@tabler/icons-vue";
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import ConfirmDialog from "@/components/base/ConfirmDialog.vue";
import DangerIconButton from "@/components/base/DangerIconButton.vue";
import SectionHeader from "@/components/settings/sections/SectionHeader.vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useChatStore } from "@/stores/chat";
import { MEMORY_CATEGORIES, MEMORY_FACT_KINDS } from "@zen/shared";

import type {
  ConversationMemoryList,
  ConversationMemorySettings,
  ConversationMemoryState,
  MemoryCategory,
  MemoryConsolidationResult,
  MemoryEpisode,
  MemoryFact,
  MemoryFactKind,
  MemoryIngestMessage,
  MemoryModelRef,
  MemoryNote,
  MemoryScope,
  MemoryView,
  ProviderSummary,
} from "@zen/shared";

/**
 * 记忆：Nomi 式长期记忆（对话摘要 / 事实 / 用户档案 / 召回设置）
 * + Zen 既有的设备环境快照、分类索引的设备备注与用户习惯。
 *
 * 两者数据互相独立：关闭长期记忆不影响设备/习惯记忆；
 * 清空对话记忆也不会动设备备注与用户档案。
 *
 * 设备备注数量会长期增长，像技能一样「索引 + 按需读取」：
 * 主进程只在视图里给分类索引，展开某一类时才通过 IPC 读取该类正文。
 * 整固 = 模型合并去重 + diff 审阅后原子替换。
 */
const { t } = useI18n();

// ---------------------------------------------------------------------------
// 对话记忆（episodes / facts / persona / 召回设置）
// ---------------------------------------------------------------------------

const TAB_KEYS = ["episodes", "facts", "persona", "device", "settings"] as const;
type MemoryTab = (typeof TAB_KEYS)[number];
const tab = ref<MemoryTab>("episodes");

const SESSION_MODEL_KEY = "__session__";
const TOP_K_CHOICES = [1, 2, 3, 5, 8];
const DEFAULT_CONVERSATION_SETTINGS: ConversationMemorySettings = {
  enabled: false,
  autoSummarize: false,
  autoExtractFacts: false,
  recall: false,
  topK: 3,
  model: null,
};
/** 摘要/事实的更新时间：复用同一个格式器，避免列表每次渲染都新建 Intl */
const shortTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const convState = ref<ConversationMemoryState | null>(null);
const episodes = ref<MemoryEpisode[]>([]);
const facts = ref<MemoryFact[]>([]);
const persona = ref("");
const personaDraft = ref("");
const searchQuery = ref("");
const searchInput = ref<{ focus: () => void } | null>(null);
/** 内联错误（写操作失败原因）与临时提示（成功/太短等中性信息）分开，避免成功也显示成红色 */
const convError = ref("");
const convNotice = ref("");
const summarizing = ref(false);
const exporting = ref<"json" | "md" | "">("");
const exportPath = ref("");
const clearing = ref(false);
const unsubscribeChanged = ref<(() => void) | null>(null);
let searchTimer: ReturnType<typeof setTimeout> | undefined;

/** 行内编辑草稿：用 id 标记正在编辑的行，避免模板里反复判空 */
const episodeEditId = ref("");
const episodeEdit = reactive({ title: "", summary: "" });
const factEditId = ref("");
const factEdit = reactive({ text: "", kind: "identity" as MemoryFactKind });
const newFactKind = ref<MemoryFactKind>("identity");
const newFactText = ref("");

const pendingConvDelete = ref<{ kind: "episode" | "fact"; id: string; text: string } | null>(null);
const pendingClear = ref(false);

const convSettings = computed<ConversationMemorySettings>(
  () => convState.value?.settings ?? DEFAULT_CONVERSATION_SETTINGS,
);
const convStats = computed(
  () => convState.value?.stats ?? { episodes: 0, facts: 0, personaChars: 0 },
);
const personaDirty = computed(() => personaDraft.value !== persona.value);
const topKChoices = computed(() => {
  const values = new Set([...TOP_K_CHOICES, convSettings.value.topK]);
  return [...values].sort((a, b) => a - b);
});

const toggles = computed(() => [
  {
    key: "enabled" as const,
    testid: "mem-switch-enabled",
    label: t("memory.settings.enabled"),
    desc: t("memory.settings.enabledDesc"),
    value: convSettings.value.enabled,
    disabled: false,
  },
  {
    key: "autoSummarize" as const,
    testid: "mem-switch-auto-summarize",
    label: t("memory.settings.autoSummarize"),
    desc: t("memory.settings.autoSummarizeDesc"),
    value: convSettings.value.autoSummarize,
    disabled: !convSettings.value.enabled,
  },
  {
    key: "autoExtractFacts" as const,
    testid: "mem-switch-auto-extract",
    label: t("memory.settings.autoExtractFacts"),
    desc: t("memory.settings.autoExtractFactsDesc"),
    value: convSettings.value.autoExtractFacts,
    disabled: !convSettings.value.enabled,
  },
  {
    key: "recall" as const,
    testid: "mem-switch-recall",
    label: t("memory.settings.recall"),
    desc: t("memory.settings.recallDesc"),
    value: convSettings.value.recall,
    disabled: !convSettings.value.enabled,
  },
]);

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function conversationBridge() {
  return window.zen?.memory?.conversations;
}

function applyList(list: ConversationMemoryList) {
  episodes.value = list.episodes ?? [];
  facts.value = list.facts ?? [];
}

async function loadState() {
  const conv = conversationBridge();
  if (!conv) {
    return;
  }
  convState.value = await conv.state();
}

async function loadList(query?: string) {
  const conv = conversationBridge();
  if (!conv) {
    return;
  }
  applyList(await conv.list(query));
}

async function loadPersona() {
  const conv = conversationBridge();
  if (!conv) {
    return;
  }
  persona.value = await conv.persona();
  if (!personaDirty.value) {
    personaDraft.value = persona.value;
  }
}

/** 全量刷新：状态（统计/设置）+ 当前搜索条件下的列表 + 档案（未编辑时） */
async function refreshConversations() {
  if (!conversationBridge()) {
    return;
  }
  const query = searchQuery.value.trim() || undefined;
  try {
    await Promise.all([loadState(), loadList(query)]);
    if (!personaDirty.value) {
      await loadPersona();
    }
  } catch (error) {
    convError.value = errText(error);
  }
}

function applyMutationList(list: ConversationMemoryList) {
  applyList(list);
  void loadState().catch((error: unknown) => {
    convError.value = errText(error);
  });
}

async function patchSettings(patch: Partial<ConversationMemorySettings>) {
  const conv = conversationBridge();
  if (!conv) {
    return;
  }
  convError.value = "";
  try {
    convState.value = await conv.setSettings(patch);
  } catch (error) {
    convError.value = errText(error);
  }
}

function setToggle(
  key: "enabled" | "autoSummarize" | "autoExtractFacts" | "recall",
  value: boolean,
) {
  const patch: Partial<ConversationMemorySettings> = {};
  patch[key] = value;
  void patchSettings(patch);
}

function parseModelKey(key: string): MemoryModelRef | null {
  if (!key || key === SESSION_MODEL_KEY) {
    return null;
  }
  try {
    const parsed = JSON.parse(key) as unknown;
    if (Array.isArray(parsed) && typeof parsed[0] === "string" && typeof parsed[1] === "string") {
      return { providerId: parsed[0], modelId: parsed[1] };
    }
  } catch {
    // key 不合法按「跟随会话模型」处理
  }
  return null;
}

const memoryModelKey = computed<string>({
  get() {
    const model = convSettings.value.model;
    return model ? JSON.stringify([model.providerId, model.modelId]) : SESSION_MODEL_KEY;
  },
  set(value) {
    void patchSettings({ model: parseModelKey(value) });
  },
});

const topKValue = computed<string>({
  get: () => String(convSettings.value.topK),
  set: (value) => void patchSettings({ topK: Number(value) }),
});

/** 已保存但已不在可选列表里的模型也展示出来，避免下拉显示错位 */
const memoryModelOptions = computed(() => {
  const options = [...availableModels.value];
  const model = convSettings.value.model;
  if (!model) {
    return options;
  }
  const key = JSON.stringify([model.providerId, model.modelId]);
  if (!options.some((item) => item.key === key)) {
    options.unshift({ key, providerId: model.providerId, modelId: model.modelId, label: key });
  }
  return options;
});

/** 手动总结当前会话：取 chat store 里的消息，过滤空内容与报错消息 */
async function summarizeNow() {
  const conv = conversationBridge();
  if (!conv || summarizing.value) {
    return;
  }
  const chat = useChatStore();
  const messages: MemoryIngestMessage[] = [];
  for (const message of chat.messages) {
    if (message.role !== "user" && message.role !== "assistant") {
      continue;
    }
    const content = message.content?.trim();
    if (!content) {
      continue;
    }
    if (message.meta?.error) {
      continue;
    }
    messages.push({ role: message.role, content });
  }
  convError.value = "";
  convNotice.value = "";
  if (!messages.length) {
    convNotice.value = t("memory.episodes.tooShort");
    return;
  }
  summarizing.value = true;
  try {
    const result = await conv.ingest(chat.sessionId, messages, { force: true });
    if (result.skipped === "too-short") {
      convNotice.value = t("memory.episodes.tooShort");
      return;
    }
    if (!result.ok) {
      convError.value = result.error || t("memory.episodes.ingestFailed");
      return;
    }
    convNotice.value = result.episode
      ? t("memory.episodes.summarized")
      : t("memory.episodes.noContent");
    await refreshConversations();
  } catch (error) {
    convError.value = errText(error);
  } finally {
    summarizing.value = false;
  }
}

function startEpisodeEdit(episode: MemoryEpisode) {
  episodeEditId.value = episode.id;
  episodeEdit.title = episode.title;
  episodeEdit.summary = episode.summary;
}

function cancelEpisodeEdit() {
  episodeEditId.value = "";
}

async function saveEpisodeEdit() {
  const conv = conversationBridge();
  const id = episodeEditId.value;
  if (!conv || !id) {
    return;
  }
  const title = episodeEdit.title.trim();
  const summary = episodeEdit.summary.trim();
  if (!title && !summary) {
    return;
  }
  convError.value = "";
  try {
    applyMutationList(await conv.updateEpisode(id, { title, summary }));
    episodeEditId.value = "";
    convNotice.value = t("memory.episodes.saved");
  } catch (error) {
    convError.value = errText(error);
  }
}

async function toggleEpisodePin(episode: MemoryEpisode) {
  const conv = conversationBridge();
  if (!conv) {
    return;
  }
  convError.value = "";
  try {
    applyMutationList(await conv.updateEpisode(episode.id, { pinned: !episode.pinned }));
  } catch (error) {
    convError.value = errText(error);
  }
}

async function addFact() {
  const conv = conversationBridge();
  const text = newFactText.value.trim();
  if (!conv || !text) {
    return;
  }
  convError.value = "";
  try {
    applyMutationList(await conv.upsertFact({ text, kind: newFactKind.value }));
    newFactText.value = "";
    convNotice.value = t("memory.facts.saved");
  } catch (error) {
    convError.value = errText(error);
  }
}

function startFactEdit(fact: MemoryFact) {
  factEditId.value = fact.id;
  factEdit.text = fact.text;
  factEdit.kind = fact.kind;
}

function cancelFactEdit() {
  factEditId.value = "";
}

async function saveFactEdit() {
  const conv = conversationBridge();
  const id = factEditId.value;
  const text = factEdit.text.trim();
  if (!conv || !id || !text) {
    return;
  }
  convError.value = "";
  try {
    applyMutationList(await conv.upsertFact({ id, text, kind: factEdit.kind }));
    factEditId.value = "";
    convNotice.value = t("memory.facts.saved");
  } catch (error) {
    convError.value = errText(error);
  }
}

async function confirmConversationDelete() {
  const conv = conversationBridge();
  const target = pendingConvDelete.value;
  if (!conv || !target) {
    return;
  }
  convError.value = "";
  try {
    applyMutationList(await conv.remove(target.kind, target.id));
    pendingConvDelete.value = null;
    convNotice.value =
      target.kind === "episode" ? t("memory.episodes.deleted") : t("memory.facts.deleted");
  } catch (error) {
    convError.value = errText(error);
  }
}

async function savePersona() {
  const conv = conversationBridge();
  if (!conv || !personaDirty.value) {
    return;
  }
  convError.value = "";
  try {
    await conv.setPersona(personaDraft.value);
    persona.value = personaDraft.value;
    convNotice.value = t("memory.persona.saved");
    await loadState();
  } catch (error) {
    convError.value = errText(error);
  }
}

async function exportMemory(format: "json" | "md") {
  const conv = conversationBridge();
  if (!conv || exporting.value) {
    return;
  }
  exporting.value = format;
  convError.value = "";
  exportPath.value = "";
  try {
    const result = await conv.exportAll(format);
    if (result.ok && result.path) {
      exportPath.value = result.path;
    } else if (!result.ok) {
      convError.value = result.error || t("memory.settings.exportFailed");
    }
  } catch (error) {
    convError.value = errText(error);
  } finally {
    exporting.value = "";
  }
}

async function clearConversations() {
  const conv = conversationBridge();
  if (!conv || clearing.value) {
    return;
  }
  clearing.value = true;
  convError.value = "";
  try {
    applyMutationList(await conv.clear());
    pendingClear.value = false;
    exportPath.value = "";
    convNotice.value = t("memory.settings.cleared");
  } catch (error) {
    convError.value = errText(error);
  } finally {
    clearing.value = false;
  }
}

watch(searchQuery, () => {
  if (searchTimer) {
    clearTimeout(searchTimer);
  }
  searchTimer = setTimeout(() => {
    convError.value = "";
    void loadList(searchQuery.value.trim() || undefined).catch((error: unknown) => {
      convError.value = errText(error);
    });
  }, 300);
});

/** `Alt+1..5` 切页签；`/` 聚焦搜索（仅列表页签，且焦点不在输入框里） */
function onGlobalKeydown(event: KeyboardEvent) {
  if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    const index = Number(event.key);
    if (Number.isInteger(index) && index >= 1 && index <= TAB_KEYS.length) {
      event.preventDefault();
      tab.value = TAB_KEYS[index - 1];
      return;
    }
  }
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
    return;
  }
  if (tab.value !== "episodes") {
    return;
  }
  const target = event.target as HTMLElement | null;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
    return;
  }
  event.preventDefault();
  searchInput.value?.focus();
}

// ---------------------------------------------------------------------------
// 设备记忆 + 用户习惯（既有能力，行为不变）
// ---------------------------------------------------------------------------

const memory = ref<MemoryView | null>(null);
const memoryBusy = ref(false);
/** 两个备注范围的草稿输入（按 scope 索引） */
const noteDrafts = reactive<Record<MemoryScope, string>>({ device: "", user: "" });
/** 设备备注新增时选的分类（缺省 other，也可不改由主进程按内容推断？这里显式选更可控） */
const draftCategory = ref<MemoryCategory>("other");
/** 展开中的设备备注分类 + 该分类已加载的正文 */
const expandedCategory = ref<MemoryCategory | null>(null);
const categoryNotes = ref<MemoryNote[]>([]);
const categoryLoading = ref(false);
const pendingDelete = ref<{ scope: MemoryScope; id: string; text: string } | null>(null);
const deleteBusy = ref(false);

// 整固：预览（模型算 diff）→ Dialog 审阅 → 确认后原子写入；失败/取消不动原始数据
const consolidateScope = ref<MemoryScope | null>(null);
const providers = ref<ProviderSummary[]>([]);
const modelsLoading = ref(false);
const modelsError = ref("");
const selectedModelKey = ref("");
let modelsRequestId = 0;
const availableModels = computed(() => providers.value.flatMap((provider) =>
  provider.enabled && (provider.hasApiKey || provider.authMode === "chatgpt-oauth")
    ? provider.models.filter((model) => model.enabled).map((model) => ({
        key: JSON.stringify([provider.id, model.id]),
        providerId: provider.id,
        modelId: model.id,
        label: `${provider.name} · ${model.name}`,
      }))
    : [],
));
const previewResult = ref<MemoryConsolidationResult | null>(null);
const previewError = ref("");
const previewBusy = ref(false);
const applyBusy = ref(false);

const deviceTools = computed(() => Object.entries(memory.value?.device?.tools ?? {}));
/** 设备备注分类索引（不含正文） */
const deviceGroups = computed(() => memory.value?.device?.groups ?? []);
const deviceTotal = computed(() =>
  deviceGroups.value.reduce((sum, group) => sum + group.count, 0),
);
const userNoteList = computed(() => memory.value?.user?.notes ?? []);
const consolidateScopeLabel = computed(() =>
  consolidateScope.value === "user"
    ? t("settings.agent.userHabits")
    : t("settings.agent.deviceNotes"),
);

const CATEGORY_LABELS = computed<Record<MemoryCategory, string>>(() => ({
  project: t("settings.agent.memoryCategories.project"),
  hardware: t("settings.agent.memoryCategories.hardware"),
  env: t("settings.agent.memoryCategories.env"),
  tool: t("settings.agent.memoryCategories.tool"),
  other: t("settings.agent.memoryCategories.other"),
}));

const FACT_KIND_LABELS = computed<Record<MemoryFactKind, string>>(() => ({
  identity: t("memory.facts.kinds.identity"),
  preference: t("memory.facts.kinds.preference"),
  project: t("memory.facts.kinds.project"),
  goal: t("memory.facts.kinds.goal"),
  note: t("memory.facts.kinds.note"),
}));

function noteStats(notes: Array<{ text: string }>): { count: number; chars: number } {
  return {
    count: notes.length,
    chars: notes.reduce((total, note) => total + note.text.length, 0),
  };
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

function formatShortTime(ms: number): string {
  return shortTimeFormat.format(ms);
}

async function loadMemory() {
  const zen = window.zen;
  if (!zen?.memory) {
    return;
  }
  memory.value = await zen.memory.get();
}

/** 展开/收起某类设备备注：展开时才按需读取该类正文 */
async function toggleCategory(category: MemoryCategory) {
  if (expandedCategory.value === category) {
    expandedCategory.value = null;
    categoryNotes.value = [];
    return;
  }
  expandedCategory.value = category;
  await loadCategory(category);
}

async function loadCategory(category: MemoryCategory) {
  const zen = window.zen;
  if (!zen?.memory || !zen.memory.notes) {
    return;
  }
  categoryLoading.value = true;
  try {
    categoryNotes.value = await zen.memory.notes("device", category);
  } finally {
    categoryLoading.value = false;
  }
}

async function addNote(scope: MemoryScope) {
  const zen = window.zen;
  const text = noteDrafts[scope].trim();
  if (!zen?.memory || !text) {
    return;
  }
  memory.value = await zen.memory.addNote(
    scope,
    text,
    scope === "device" ? draftCategory.value : undefined,
  );
  noteDrafts[scope] = "";
  if (scope === "device") {
    // 新备注可能落在任意分类：索引已刷新，展开中的分类重新读取正文
    if (expandedCategory.value) {
      await loadCategory(expandedCategory.value);
    }
  }
}

async function removeNote() {
  const zen = window.zen;
  const target = pendingDelete.value;
  if (!zen?.memory || !target) {
    return;
  }
  deleteBusy.value = true;
  try {
    memory.value = await zen.memory.removeNote(target.scope, target.id);
    pendingDelete.value = null;
    if (target.scope === "device" && expandedCategory.value) {
      await loadCategory(expandedCategory.value);
    }
  } finally {
    deleteBusy.value = false;
  }
}

async function recollect() {
  const zen = window.zen;
  if (!zen?.memory) {
    return;
  }
  memoryBusy.value = true;
  try {
    memory.value = await zen.memory.collect();
    if (expandedCategory.value) {
      await loadCategory(expandedCategory.value);
    }
  } finally {
    memoryBusy.value = false;
  }
}

/** 记忆模型与整固模型共用同一份可用模型列表（同一次进入设置页只读一次） */
async function loadProviders() {
  const zen = window.zen;
  if (!zen?.memory || !zen.models || modelsLoading.value) {
    return;
  }
  const requestId = ++modelsRequestId;
  modelsError.value = "";
  modelsLoading.value = true;
  try {
    const list = await zen.models.list();
    if (requestId === modelsRequestId) providers.value = list;
  } catch (error) {
    if (requestId === modelsRequestId) {
      modelsError.value = errText(error);
    }
  } finally {
    if (requestId === modelsRequestId) modelsLoading.value = false;
  }
}

async function startConsolidate(scope: MemoryScope) {
  const zen = window.zen;
  if (!zen?.memory || !zen.models || consolidateScope.value) {
    return;
  }
  consolidateScope.value = scope;
  selectedModelKey.value = "";
  providers.value = [];
  modelsError.value = "";
  previewResult.value = null;
  previewError.value = "";
  await loadProviders();
}

async function generatePreview() {
  const zen = window.zen;
  const scope = consolidateScope.value;
  const model = availableModels.value.find((item) => item.key === selectedModelKey.value);
  if (!zen?.memory || !scope || !model || previewBusy.value) {
    return;
  }
  previewError.value = "";
  previewBusy.value = true;
  try {
    const result = await zen.memory.consolidatePreview(scope, model.providerId, model.modelId);
    if (result.ok) {
      previewResult.value = result;
    } else {
      previewError.value = result.error ?? "";
    }
  } catch (error) {
    previewError.value = errText(error);
  } finally {
    previewBusy.value = false;
  }
}

async function applyConsolidated() {
  const zen = window.zen;
  const scope = consolidateScope.value;
  const result = previewResult.value;
  if (!zen?.memory || !scope || !result) {
    return;
  }
  applyBusy.value = true;
  try {
    // zen-005：ref 内对象过桥前先序列化成纯值
    memory.value = await zen.memory.applyConsolidation(
      scope,
      JSON.parse(JSON.stringify(result.after)) as Array<{
        id: string;
        text: string;
        createdAt: number;
      }>,
    );
    consolidateScope.value = null;
    previewResult.value = null;
    previewError.value = "";
    if (scope === "device") {
      expandedCategory.value = null;
      categoryNotes.value = [];
    }
  } finally {
    applyBusy.value = false;
  }
}

function closeConsolidate() {
  if (previewBusy.value || applyBusy.value) {
    return;
  }
  ++modelsRequestId;
  consolidateScope.value = null;
  selectedModelKey.value = "";
  providers.value = [];
  modelsLoading.value = false;
  modelsError.value = "";
  previewResult.value = null;
  previewError.value = "";
}

watch(tab, (next) => {
  convError.value = "";
  convNotice.value = "";
  if (next === "settings" && !providers.value.length) {
    void loadProviders();
  }
});

onMounted(() => {
  void loadMemory().catch((error: unknown) => {
    convError.value = errText(error);
  });
  void refreshConversations();
  void loadPersona().catch((error: unknown) => {
    convError.value = errText(error);
  });
  const conv = conversationBridge();
  if (conv) {
    unsubscribeChanged.value = conv.onChanged(() => {
      void refreshConversations();
    });
  }
  window.addEventListener("keydown", onGlobalKeydown);
});

onUnmounted(() => {
  unsubscribeChanged.value?.();
  unsubscribeChanged.value = null;
  window.removeEventListener("keydown", onGlobalKeydown);
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = undefined;
  }
});
</script>

<template>
  <section id="set-agent-memory" class="flex flex-col gap-3 scroll-mt-2">
    <SectionHeader
      :icon="Brain"
      :title="t('settings.agent.memoryTitle')"
      :desc="t('settings.agent.memoryDesc')"
    />

    <!-- 总开关关闭：显式提示并给一键开启，避免「为什么没有自动摘要」 -->
    <div
      v-if="convState && !convSettings.enabled"
      class="flex flex-wrap items-center gap-2 rounded-lg bg-[color-mix(in_srgb,var(--color-warn,#d97709)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--color-mut)]"
    >
      <TriangleAlert :size="14" class="flex-none text-[var(--color-warn,#d97709)]" />
      <span class="min-w-0 flex-1">{{ t("memory.disabledNotice") }}</span>
      <Button variant="ghost" size="sm" @click="setToggle('enabled', true)">
        {{ t("memory.enable") }}
      </Button>
    </div>

    <!-- 统计：一眼看清规模；失败信息紧随其后，不用翻到设置页 -->
    <div class="grid grid-cols-3 gap-1.5">
      <div
        class="flex flex-col items-start gap-0.5 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-set-card)] px-2.5 py-1.5"
      >
        <span class="text-[15px] font-semibold tabular-nums text-[var(--color-txt-strong)]">
          {{ convStats.episodes }}
        </span>
        <span class="text-[10px] text-[var(--color-dim)]">{{ t("memory.stats.episodes") }}</span>
      </div>
      <div
        class="flex flex-col items-start gap-0.5 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-set-card)] px-2.5 py-1.5"
      >
        <span class="text-[15px] font-semibold tabular-nums text-[var(--color-txt-strong)]">
          {{ convStats.facts }}
        </span>
        <span class="text-[10px] text-[var(--color-dim)]">{{ t("memory.stats.facts") }}</span>
      </div>
      <div
        class="flex flex-col items-start gap-0.5 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-set-card)] px-2.5 py-1.5"
      >
        <span class="text-[15px] font-semibold tabular-nums text-[var(--color-txt-strong)]">
          {{ convStats.personaChars }}
        </span>
        <span class="text-[10px] text-[var(--color-dim)]">{{ t("memory.stats.personaChars") }}</span>
      </div>
    </div>

    <p v-if="convState?.lastError" class="m-0 text-[11px] leading-snug text-[var(--color-err)]">
      {{ t("memory.lastError", { error: convState.lastError }) }}
    </p>
    <p v-if="convError" role="alert" class="m-0 text-[11px] leading-snug text-[var(--color-err)]">
      {{ t("memory.errorLine", { error: convError }) }}
    </p>
    <p v-else-if="convNotice" role="status" class="m-0 text-[11px] leading-snug text-[var(--color-mut)]">
      {{ convNotice }}
    </p>

    <Tabs v-model="tab" class="flex flex-col gap-2.5">
      <TabsList class="flex flex-wrap">
        <TabsTrigger value="episodes" data-testid="mem-tab-episodes" class="text-[12px]">
          {{ t("memory.tabs.episodes") }}
          <span class="rounded-full bg-[var(--color-chip-bg)] px-1.5 text-[10px] tabular-nums text-[var(--color-mut)]">
            {{ convStats.episodes }}
          </span>
        </TabsTrigger>
        <TabsTrigger value="facts" data-testid="mem-tab-facts" class="text-[12px]">
          {{ t("memory.tabs.facts") }}
          <span class="rounded-full bg-[var(--color-chip-bg)] px-1.5 text-[10px] tabular-nums text-[var(--color-mut)]">
            {{ convStats.facts }}
          </span>
        </TabsTrigger>
        <TabsTrigger value="persona" data-testid="mem-tab-persona" class="text-[12px]">
          {{ t("memory.tabs.persona") }}
        </TabsTrigger>
        <TabsTrigger value="device" data-testid="mem-tab-device" class="text-[12px]">
          {{ t("memory.tabs.device") }}
          <span class="rounded-full bg-[var(--color-chip-bg)] px-1.5 text-[10px] tabular-nums text-[var(--color-mut)]">
            {{ deviceTotal + userNoteList.length }}
          </span>
        </TabsTrigger>
        <TabsTrigger value="settings" data-testid="mem-tab-settings" class="text-[12px]">
          {{ t("memory.tabs.settings") }}
        </TabsTrigger>
      </TabsList>

      <!-- 1. 对话记忆 -->
      <TabsContent value="episodes" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <Input
            ref="searchInput"
            v-model="searchQuery"
            variant="ghost"
            class="h-8 min-w-0 flex-1 basis-[180px] text-[12px]"
            data-testid="mem-search"
            :placeholder="t('memory.episodes.searchPlaceholder')"
          />
          <Button
            variant="outline"
            size="sm"
            data-testid="mem-summarize"
            :disabled="summarizing"
            @click="summarizeNow"
          >
            <Loader2 v-if="summarizing" class="size-3.5 animate-spin" aria-hidden="true" />
            <Sparkles v-else :size="13" data-icon="inline-start" />
            {{ summarizing ? t("memory.episodes.summarizing") : t("memory.episodes.summarizeNow") }}
          </Button>
        </div>

        <p v-if="!episodes.length" class="m-0 px-1 py-2 text-[11px] leading-relaxed text-[var(--color-dim)]">
          {{ searchQuery.trim() ? t("memory.episodes.emptySearch") : t("memory.episodes.empty") }}
        </p>
        <ul v-else class="m-0 flex list-none flex-col gap-1.5 p-0">
          <li
            v-for="episode in episodes"
            :key="episode.id"
            class="flex flex-col gap-1 rounded-xl border border-[var(--color-line)] bg-[var(--color-set-card)] px-3 py-2"
          >
            <!-- 行内编辑：⌘/Ctrl+Enter 保存，Esc 取消 -->
            <div
              v-if="episodeEditId === episode.id"
              class="flex flex-col gap-1.5"
              @keydown.meta.enter.prevent="saveEpisodeEdit"
              @keydown.ctrl.enter.prevent="saveEpisodeEdit"
              @keydown.esc.stop.prevent="cancelEpisodeEdit"
            >
              <Input
                v-model="episodeEdit.title"
                class="h-8 text-[12px]"
                maxlength="120"
                :placeholder="t('memory.episodes.titlePlaceholder')"
                :aria-label="t('memory.episodes.titlePlaceholder')"
              />
              <Textarea
                v-model="episodeEdit.summary"
                rows="4"
                maxlength="2000"
                class="text-[12px]"
                :placeholder="t('memory.episodes.summaryPlaceholder')"
                :aria-label="t('memory.episodes.summaryPlaceholder')"
              />
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="min-w-0 flex-1 text-[10px] text-[var(--color-dim)]">
                  {{ t("memory.episodes.editHint") }}
                </span>
                <Button variant="default" size="sm" @click="saveEpisodeEdit">
                  {{ t("memory.common.save") }}
                </Button>
                <Button variant="ghost" size="sm" @click="cancelEpisodeEdit">
                  {{ t("memory.common.cancel") }}
                </Button>
              </div>
            </div>

            <template v-else>
              <div class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span class="min-w-0 flex-1 text-[12px] font-medium text-[var(--color-txt-strong)]">
                  {{ episode.title }}
                </span>
                <Badge v-if="episode.pinned" variant="outline" class="h-4 px-1.5 text-[10px]">
                  {{ t("memory.episodes.pinned") }}
                </Badge>
                <Badge v-if="episode.edited" variant="outline" class="h-4 px-1.5 text-[10px]">
                  {{ t("memory.episodes.edited") }}
                </Badge>
                <span class="flex-none text-[10px] tabular-nums text-[var(--color-dim)]">
                  {{ t("memory.episodes.updatedAt", { time: formatShortTime(episode.updatedAt) }) }}
                </span>
              </div>
              <p class="m-0 line-clamp-3 text-[11px] leading-snug text-[var(--color-mut)]">
                {{ episode.summary }}
              </p>
              <div v-if="episode.keywords?.length" class="flex flex-wrap gap-1">
                <span
                  v-for="keyword in episode.keywords"
                  :key="keyword"
                  class="rounded-full bg-[var(--color-chip-bg)] px-1.5 py-0.5 text-[10px] text-[var(--color-dim)]"
                >
                  {{ keyword }}
                </span>
              </div>
              <div class="flex flex-wrap items-center gap-1">
                <span class="mr-auto text-[10px] tabular-nums text-[var(--color-dim)]">
                  {{ t("memory.episodes.messageCount", { count: episode.messageCount }) }}
                </span>
                <Button variant="ghost" size="sm" class="h-6 px-1.5 text-[11px]" @click="startEpisodeEdit(episode)">
                  {{ t("memory.common.edit") }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-[11px]"
                  @click="toggleEpisodePin(episode)"
                >
                  {{ episode.pinned ? t("memory.common.unpin") : t("memory.common.pin") }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-[11px] text-[var(--color-del)]"
                  data-testid="mem-episode-delete"
                  @click="pendingConvDelete = { kind: 'episode', id: episode.id, text: episode.title }"
                >
                  {{ t("memory.common.delete") }}
                </Button>
              </div>
            </template>
          </li>
        </ul>
      </TabsContent>

      <!-- 2. 关于我 -->
      <TabsContent value="facts" class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center gap-1.5">
          <Select v-model="newFactKind">
            <SelectTrigger size="sm" class="h-8 w-[96px] flex-none text-[12px]" :aria-label="t('memory.facts.add')">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="kind in MEMORY_FACT_KINDS" :key="kind" :value="kind">
                  {{ FACT_KIND_LABELS[kind] }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Input
            v-model="newFactText"
            class="h-8 min-w-0 flex-1 basis-[180px] text-[12px]"
            maxlength="400"
            data-testid="mem-new-fact"
            :placeholder="t('memory.facts.addPlaceholder')"
            :aria-label="t('memory.facts.addPlaceholder')"
            @keydown.enter.prevent="addFact"
          />
          <Button variant="outline" size="sm" :disabled="!newFactText.trim()" @click="addFact">
            <Plus :size="13" data-icon="inline-start" />{{ t("memory.facts.add") }}
          </Button>
        </div>

        <p v-if="!facts.length" class="m-0 px-1 py-2 text-[11px] leading-relaxed text-[var(--color-dim)]">
          {{ t("memory.facts.empty") }}
        </p>
        <ul v-else class="m-0 flex list-none flex-col gap-1 p-0">
          <li
            v-for="fact in facts"
            :key="fact.id"
            class="flex flex-col gap-1 rounded-lg border border-[var(--color-line-soft)] bg-[var(--color-set-card)] px-2.5 py-1.5"
          >
            <div
              v-if="factEditId === fact.id"
              class="flex flex-col gap-1.5"
              @keydown.meta.enter.prevent="saveFactEdit"
              @keydown.ctrl.enter.prevent="saveFactEdit"
              @keydown.esc.stop.prevent="cancelFactEdit"
            >
              <div class="flex flex-wrap items-center gap-1.5">
                <Select v-model="factEdit.kind">
                  <SelectTrigger size="sm" class="h-8 w-[96px] flex-none text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem v-for="kind in MEMORY_FACT_KINDS" :key="kind" :value="kind">
                        {{ FACT_KIND_LABELS[kind] }}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <Input v-model="factEdit.text" class="h-8 min-w-0 flex-1 basis-[160px] text-[12px]" maxlength="400" />
              </div>
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="min-w-0 flex-1 text-[10px] text-[var(--color-dim)]">
                  {{ t("memory.facts.editHint") }}
                </span>
                <Button variant="default" size="sm" @click="saveFactEdit">
                  {{ t("memory.common.save") }}
                </Button>
                <Button variant="ghost" size="sm" @click="cancelFactEdit">
                  {{ t("memory.common.cancel") }}
                </Button>
              </div>
            </div>

            <div v-else class="flex flex-wrap items-start gap-1.5">
              <Badge variant="outline" class="h-4 px-1.5 text-[10px]">
                {{ FACT_KIND_LABELS[fact.kind] }}
              </Badge>
              <Badge
                variant="outline"
                class="h-4 px-1.5 text-[10px]"
                :class="fact.source === 'auto' ? 'text-[var(--color-dim)]' : 'text-[var(--color-mut)]'"
              >
                {{ fact.source === "auto" ? t("memory.facts.sourceAuto") : t("memory.facts.sourceUser") }}
              </Badge>
              <span class="min-w-0 flex-1 break-words text-[11px] leading-snug text-[var(--color-txt)]">
                {{ fact.text }}
              </span>
              <div class="flex flex-none items-center gap-1">
                <Button variant="ghost" size="sm" class="h-6 px-1.5 text-[11px]" @click="startFactEdit(fact)">
                  {{ t("memory.common.edit") }}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  class="h-6 px-1.5 text-[11px] text-[var(--color-del)]"
                  data-testid="mem-fact-delete"
                  @click="pendingConvDelete = { kind: 'fact', id: fact.id, text: fact.text }"
                >
                  {{ t("memory.common.delete") }}
                </Button>
              </div>
            </div>
          </li>
        </ul>
      </TabsContent>

      <!-- 3. 用户档案 -->
      <TabsContent value="persona" class="flex flex-col gap-2">
        <p class="m-0 text-[11px] leading-relaxed text-[var(--color-mut)]">
          {{ t("memory.persona.hint") }}
        </p>
        <Textarea
          v-model="personaDraft"
          rows="8"
          maxlength="8000"
          class="min-h-32 text-[12px]"
          data-testid="mem-persona"
          :placeholder="t('memory.persona.placeholder')"
          :aria-label="t('memory.tabs.persona')"
          @keydown.meta.s.prevent="savePersona"
          @keydown.ctrl.s.prevent="savePersona"
        />
        <div class="flex flex-wrap items-center gap-1.5">
          <span class="text-[10px] tabular-nums text-[var(--color-dim)]">
            {{ t("memory.persona.chars", { count: personaDraft.length }) }}
          </span>
          <span v-if="personaDirty" class="text-[10px] text-[var(--color-warn,#d97709)]">
            {{ t("memory.persona.dirty") }}
          </span>
          <span class="flex-1" />
          <Button variant="default" size="sm" :disabled="!personaDirty" @click="savePersona">
            {{ t("memory.persona.save") }}
          </Button>
        </div>
      </TabsContent>

      <!-- 4. 设备与习惯（既有能力原样搬入） -->
      <TabsContent value="device" class="flex flex-col gap-3">
        <p class="m-0 text-[11px] leading-relaxed text-[var(--color-mut)]">
          {{ t("memory.device.hint") }}
        </p>

        <!-- 设备环境：只读快照，元信息按字段行对齐 -->
        <div
          v-if="memory?.device"
          class="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-set-card)]"
        >
          <header class="flex items-center gap-2 border-b border-[var(--color-line-soft)] px-3 py-2">
            <span class="min-w-0 flex-1 text-[12px] font-medium text-[var(--color-txt-strong)]">
              {{ t("settings.agent.deviceSnapshot") }}
            </span>
            <span class="flex-none text-[11px] text-[var(--color-dim)]">
              {{ t("settings.agent.collectedAt", { time: formatTime(memory.device.collectedAt) }) }}
            </span>
            <Button variant="outline" size="sm" :disabled="memoryBusy" @click="recollect">
              <RefreshCw :size="13" data-icon="inline-start" />{{ t("settings.agent.recollect") }}
            </Button>
          </header>
          <div class="flex flex-col px-3 py-1.5">
            <div class="field-row">
              <span class="field-row-label">{{ t("settings.agent.metaSystem") }}</span>
              <span class="field-row-value">{{ memory.device.platform }} {{ memory.device.arch }}</span>
            </div>
            <div class="field-row">
              <span class="field-row-label">{{ t("settings.agent.metaShell") }}</span>
              <span class="field-row-value">{{ memory.device.shell }}</span>
            </div>
            <div v-if="memory.device.timezone" class="field-row">
              <span class="field-row-label">{{ t("settings.agent.metaTimezone") }}</span>
              <span class="field-row-value">
                {{ memory.device.timezone }}
                <template v-if="memory.device.locale"> · {{ memory.device.locale }}</template>
              </span>
            </div>
            <div class="field-row">
              <span class="field-row-label">{{ t("settings.agent.metaHome") }}</span>
              <span class="field-row-value">{{ memory.device.home }}</span>
            </div>
            <div v-if="deviceTools.length" class="field-row">
              <span class="field-row-label">{{ t("settings.agent.metaTools") }}</span>
              <div class="flex flex-wrap gap-1.5 pt-1">
                <span
                  v-for="[name, path] in deviceTools"
                  :key="name"
                  class="inline-flex max-w-full items-baseline gap-1 rounded-md bg-[var(--color-chip-bg)] px-1.5 py-0.5 text-[10px] text-[var(--color-mut)]"
                  :title="`${name} = ${path}`"
                >
                  <span class="font-[family-name:var(--font-mono)] text-[var(--color-txt)]">{{ name }}</span>
                  <span class="min-w-0 truncate font-[family-name:var(--font-mono)]">{{ path }}</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- 设备备注：分类索引（数量 + 摘要），展开某类才读取正文 -->
        <div class="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-set-card)]">
          <header class="flex flex-wrap items-center gap-2 border-b border-[var(--color-line-soft)] px-3 py-2">
            <span class="min-w-0 flex-1 text-[12px] font-medium text-[var(--color-txt-strong)]">
              {{ t("settings.agent.deviceNotes") }}
            </span>
            <span class="flex-none text-[11px] tabular-nums text-[var(--color-dim)]">
              {{ t("settings.agent.deviceNotesCount", { count: deviceTotal, categories: deviceGroups.length }) }}
            </span>
            <Button
              variant="outline"
              size="sm"
              :disabled="previewBusy || !deviceTotal"
              @click="startConsolidate('device')"
            >
              <Sparkles :size="13" data-icon="inline-start" />{{ t("settings.agent.consolidate") }}
            </Button>
          </header>

          <p class="m-0 px-3 pb-1 pt-2 text-[11px] leading-relaxed text-[var(--color-mut)]">
            {{ t("settings.agent.deviceNotesIndexHint") }}
          </p>

          <p v-if="!deviceGroups.length" class="m-0 px-3 py-1.5 text-[11px] text-[var(--color-dim)]">
            {{ t("settings.agent.deviceNotesEmpty") }}
          </p>
          <div v-else class="flex flex-col px-2 pb-1">
            <div v-for="group in deviceGroups" :key="group.category" class="flex flex-col">
              <Button
                variant="ghost"
                class="h-auto min-h-8 w-full items-center justify-start gap-2 rounded-[var(--radius-sm)] px-1 py-1 text-left font-normal hover:bg-[var(--color-menu-hover)] dark:hover:bg-[var(--color-menu-hover)]"
                :aria-expanded="expandedCategory === group.category"
                @click="toggleCategory(group.category)"
              >
                <ChevronDown
                  v-if="expandedCategory === group.category"
                  class="size-3.5 flex-none text-[var(--color-mut)]"
                  aria-hidden="true"
                />
                <ChevronRight v-else class="size-3.5 flex-none text-[var(--color-mut)]" aria-hidden="true" />
                <span class="flex-none text-[12px] font-medium text-[var(--color-txt-strong)]">
                  {{ CATEGORY_LABELS[group.category] }}
                </span>
                <span class="inline-flex h-4 flex-none items-center rounded-full bg-[var(--color-chip-bg)] px-1.5 text-[10px] tabular-nums text-[var(--color-mut)]">
                  {{ group.count }}
                </span>
                <span class="min-w-0 flex-1 truncate text-[11px] text-[var(--color-dim)]">
                  {{ group.previews[0] }}{{ group.count > 1 ? " …" : "" }}
                </span>
              </Button>
              <div
                v-if="expandedCategory === group.category"
                class="ml-[18px] flex flex-col gap-0.5 border-l border-[var(--color-line-soft)] pb-1.5 pl-2"
              >
                <p v-if="categoryLoading" class="m-0 flex items-center gap-1.5 px-1 py-1 text-[11px] text-[var(--color-dim)]">
                  <Loader2 class="size-3 animate-spin" aria-hidden="true" />
                  {{ t("settings.agent.notesLoading") }}
                </p>
                <div
                  v-for="note in categoryNotes"
                  v-else
                  :key="note.id"
                  class="group/note flex items-start gap-2 rounded-[var(--radius-sm)] px-1 py-0.5 text-[11px] text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)]"
                >
                  <span class="mt-1 size-1 flex-none rounded-full bg-[var(--color-dim)]" aria-hidden="true" />
                  <span class="min-w-0 flex-1 break-words leading-snug">{{ note.text }}</span>
                  <DangerIconButton
                    :label="t('settings.agent.deleteDeviceNoteAria')"
                    class="opacity-0 group-hover/note:opacity-100"
                    @click="pendingDelete = { scope: 'device', id: note.id, text: note.text }"
                  >
                    <X :size="13" />
                  </DangerIconButton>
                </div>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line-soft)] px-3 py-2">
            <Select v-model="draftCategory">
              <SelectTrigger size="sm" class="h-8 w-[92px] flex-none text-[12px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem v-for="category in MEMORY_CATEGORIES" :key="category" :value="category">
                    {{ CATEGORY_LABELS[category] }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Input
              v-model="noteDrafts.device"
              variant="ghost"
              class="h-8 min-w-0 flex-1 basis-[160px] text-[12px]"
              :placeholder="t('settings.agent.deviceNotePlaceholder')"
              @keydown.enter.prevent="addNote('device')"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
              :aria-label="t('settings.agent.addDeviceNoteAria')"
              :disabled="!noteDrafts.device.trim()"
              @click="addNote('device')"
            >
              <Plus :size="14" />
            </Button>
          </div>
        </div>

        <!-- 用户习惯：数量少且总是随会话注入，保持平铺列表 -->
        <div class="overflow-hidden rounded-xl border border-[var(--color-line)] bg-[var(--color-set-card)]">
          <header class="flex flex-wrap items-center gap-2 border-b border-[var(--color-line-soft)] px-3 py-2">
            <span class="min-w-0 flex-1 text-[12px] font-medium text-[var(--color-txt-strong)]">
              {{ t("settings.agent.userHabits") }}
            </span>
            <span class="flex-none text-[11px] tabular-nums text-[var(--color-dim)]">
              {{ t("settings.agent.consolidateStats", noteStats(userNoteList)) }}
            </span>
            <Button
              variant="outline"
              size="sm"
              :disabled="previewBusy || !userNoteList.length"
              @click="startConsolidate('user')"
            >
              <Sparkles :size="13" data-icon="inline-start" />{{ t("settings.agent.consolidate") }}
            </Button>
          </header>

          <p class="m-0 px-3 pt-2 text-[11px] leading-relaxed text-[var(--color-mut)]">
            {{ t("settings.agent.userHabitsHint") }}
          </p>
          <p v-if="!userNoteList.length" class="m-0 px-3 py-1.5 text-[11px] text-[var(--color-dim)]">
            {{ t("settings.agent.userHabitsEmpty") }}
          </p>
          <ul v-else class="m-0 flex list-none flex-col gap-0.5 px-3 py-1.5">
            <li
              v-for="note in userNoteList"
              :key="note.id"
              class="group/note flex items-start gap-2 rounded-[var(--radius-sm)] py-0.5 pl-1 pr-0.5 text-[11px] text-[var(--color-txt)] hover:bg-[var(--color-menu-hover)]"
            >
              <span class="mt-1 size-1 flex-none rounded-full bg-[var(--color-dim)]" aria-hidden="true" />
              <span class="min-w-0 flex-1 break-words leading-snug">{{ note.text }}</span>
              <DangerIconButton
                :label="t('settings.agent.deleteUserNoteAria')"
                class="opacity-0 group-hover/note:opacity-100"
                @click="pendingDelete = { scope: 'user', id: note.id, text: note.text }"
              >
                <X :size="13" />
              </DangerIconButton>
            </li>
          </ul>

          <div class="flex flex-wrap items-center gap-1.5 border-t border-[var(--color-line-soft)] px-3 py-2">
            <Input
              v-model="noteDrafts.user"
              variant="ghost"
              class="h-8 min-w-0 flex-1 basis-[160px] text-[12px]"
              :placeholder="t('settings.agent.userNotePlaceholder')"
              @keydown.enter.prevent="addNote('user')"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-[var(--color-mut)] hover:text-[var(--color-txt-strong)]"
              :aria-label="t('settings.agent.addUserNoteAria')"
              :disabled="!noteDrafts.user.trim()"
              @click="addNote('user')"
            >
              <Plus :size="14" />
            </Button>
          </div>
        </div>
      </TabsContent>

      <!-- 5. 设置与导出 -->
      <TabsContent value="settings" class="flex flex-col gap-2">
        <div
          v-for="toggle in toggles"
          :key="toggle.key"
          class="flex items-start justify-between gap-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-set-card)] px-3 py-2"
        >
          <div class="flex min-w-0 flex-col gap-0.5">
            <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">{{ toggle.label }}</span>
            <p class="m-0 text-[11px] leading-snug text-[var(--color-mut)]">{{ toggle.desc }}</p>
          </div>
          <Switch
            :model-value="toggle.value"
            :disabled="toggle.disabled"
            :data-testid="toggle.testid"
            :aria-label="toggle.label"
            @update:model-value="(next) => setToggle(toggle.key, next === true)"
          />
        </div>

        <div class="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-set-card)] px-3 py-2">
          <span class="min-w-0 flex-1 text-[12px] text-[var(--color-txt-strong)]">
            {{ t("memory.settings.topK") }}
          </span>
          <Select v-model="topKValue">
            <SelectTrigger size="sm" class="h-8 w-[92px] flex-none text-[12px]" :aria-label="t('memory.settings.topK')">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem v-for="count in topKChoices" :key="count" :value="String(count)">
                  {{ t("memory.settings.topKCount", { count }) }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div class="flex flex-col gap-1.5 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-set-card)] px-3 py-2">
          <span class="text-[12px] text-[var(--color-txt-strong)]">{{ t("memory.settings.model") }}</span>
          <p v-if="modelsLoading" class="m-0 text-[11px] text-[var(--color-dim)]">
            {{ t("memory.settings.modelsLoading") }}
          </p>
          <p v-else-if="modelsError" role="alert" class="m-0 text-[11px] text-[var(--color-err)]">
            {{ t("memory.errorLine", { error: modelsError }) }}
          </p>
          <Select v-else v-model="memoryModelKey">
            <SelectTrigger size="sm" class="h-8 w-full text-[12px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem :value="SESSION_MODEL_KEY">{{ t("memory.settings.modelSession") }}</SelectItem>
                <SelectItem v-for="model in memoryModelOptions" :key="model.key" :value="model.key">
                  {{ model.label }}
                </SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <p v-if="!modelsLoading && !modelsError && !memoryModelOptions.length" class="m-0 text-[11px] text-[var(--color-dim)]">
            {{ t("memory.settings.modelsEmpty") }}
          </p>
          <p class="m-0 text-[11px] leading-snug text-[var(--color-mut)]">
            {{ t("memory.settings.modelHint") }}
          </p>
        </div>

        <div class="flex flex-col gap-1.5 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-set-card)] px-3 py-2">
          <span class="text-[12px] font-medium text-[var(--color-txt-strong)]">
            {{ t("memory.settings.exportTitle") }}
          </span>
          <p class="m-0 text-[11px] leading-snug text-[var(--color-mut)]">
            {{ t("memory.settings.exportDesc") }}
          </p>
          <div class="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              data-testid="mem-export-json"
              :disabled="!!exporting"
              @click="exportMemory('json')"
            >
              <Download :size="13" data-icon="inline-start" />
              {{ exporting === "json" ? t("memory.settings.exporting") : t("memory.settings.exportJson") }}
            </Button>
            <Button
              variant="outline"
              size="sm"
              data-testid="mem-export-md"
              :disabled="!!exporting"
              @click="exportMemory('md')"
            >
              <Download :size="13" data-icon="inline-start" />
              {{ exporting === "md" ? t("memory.settings.exporting") : t("memory.settings.exportMd") }}
            </Button>
          </div>
          <p
            v-if="exportPath"
            class="m-0 break-all text-[11px] text-[var(--color-mut)]"
            data-testid="mem-export-path"
          >
            {{ t("memory.settings.exportedTo", { path: exportPath }) }}
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-set-card)] px-3 py-2">
          <p class="m-0 min-w-0 flex-1 text-[11px] leading-snug text-[var(--color-mut)]">
            {{ t("memory.settings.clearDesc") }}
          </p>
          <Button
            variant="outline"
            size="sm"
            class="text-[var(--color-del)]"
            data-testid="mem-clear"
            @click="pendingClear = true"
          >
            {{ t("memory.settings.clear") }}
          </Button>
        </div>
      </TabsContent>
    </Tabs>

    <!-- 整固 diff 审阅：左当前 / 右整固后，两栏各自内滚不串扰；确认前不落盘 -->
    <Dialog
      :open="consolidateScope != null"
      @update:open="(next) => { if (!next) closeConsolidate(); }"
    >
      <DialogContent
        class="w-[min(720px,calc(100vw-48px))] gap-3 border border-[var(--color-line)] bg-[var(--color-popover)] p-4 shadow-[var(--shadow-pop)]"
        data-large-panel="true"
      >
        <DialogTitle class="text-[14px] font-semibold text-[var(--color-txt-strong)]">
          {{ t("settings.agent.consolidateTitle") }}
        </DialogTitle>
        <DialogDescription class="text-[12px] leading-normal text-[var(--color-mut)]">
          {{ t("settings.agent.consolidateDesc", { scope: consolidateScopeLabel }) }}
        </DialogDescription>

        <div v-if="!previewBusy && !previewResult" class="flex flex-col gap-2">
          <p v-if="modelsLoading" role="status" class="m-0 text-[12px] text-[var(--color-dim)]">
            {{ t("settings.agent.consolidateModelsLoading") }}
          </p>
          <p v-else-if="modelsError" role="alert" class="m-0 text-[12px] text-[var(--color-err)]">
            {{ t("settings.agent.consolidateModelsFailed", { error: modelsError }) }}
          </p>
          <template v-else>
            <label v-if="availableModels.length" for="consolidate-model" class="text-[12px] text-[var(--color-txt)]">
              {{ t("settings.agent.consolidateModel") }}
            </label>
            <Select v-if="availableModels.length" v-model="selectedModelKey">
              <SelectTrigger id="consolidate-model" class="w-full">
                <SelectValue :placeholder="t('settings.agent.consolidateModelPlaceholder')" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem v-for="model in availableModels" :key="model.key" :value="model.key">
                    {{ model.label }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <p v-else class="m-0 text-[12px] text-[var(--color-dim)]">
              {{ t("settings.agent.consolidateNoModels") }}
            </p>
          </template>
        </div>

        <!-- 失败：提示错误，可关闭重试；原始数据未动 -->
        <p v-if="previewError" class="m-0 text-[12px] leading-normal text-[var(--color-err)]">
          {{ t("settings.agent.consolidateFailed", { error: previewError }) }}
        </p>
        <!-- 生成中 -->
        <p v-else-if="previewBusy" class="m-0 text-[12px] text-[var(--color-dim)]">
          {{ t("settings.agent.consolidateLoading") }}
        </p>
        <!-- diff 主体 -->
        <div v-else-if="previewResult" class="grid grid-cols-2 gap-3">
          <div class="flex min-h-0 max-h-72 flex-col gap-1.5 rounded-xl border border-[var(--color-line-soft)] p-2">
            <span class="text-[11px] font-medium text-[var(--color-mut)]">
              {{ t("settings.agent.consolidateBefore", { count: previewResult.before.length }) }}
            </span>
            <ul class="m-0 flex min-h-0 list-none flex-col gap-1.5 overflow-y-auto overscroll-contain p-0">
              <li
                v-for="note in previewResult.before"
                :key="note.id"
                class="break-words text-[11px] leading-snug text-[var(--color-dim)]"
              >
                {{ note.text }}
              </li>
            </ul>
          </div>
          <div class="flex min-h-0 max-h-72 flex-col gap-1.5 rounded-xl border border-[var(--color-line-soft)] p-2">
            <span class="text-[11px] font-medium text-[var(--color-mut)]">
              {{ t("settings.agent.consolidateAfter", { count: previewResult.after.length }) }}
            </span>
            <ul class="m-0 flex min-h-0 list-none flex-col gap-1.5 overflow-y-auto overscroll-contain p-0">
              <li
                v-for="note in previewResult.after"
                :key="note.id"
                class="break-words text-[11px] leading-snug text-[var(--color-txt)]"
              >
                {{ note.text }}
              </li>
            </ul>
          </div>
        </div>
        <p
          v-if="previewResult && !previewResult.changedCount"
          class="m-0 text-[11px] text-[var(--color-dim)]"
        >
          {{ t("settings.agent.consolidateNoChange") }}
        </p>

        <div class="flex justify-end gap-1.5">
          <Button
            v-if="!previewResult"
            variant="default"
            size="sm"
            :disabled="modelsLoading || !!modelsError || previewBusy || !selectedModelKey"
            @click="generatePreview"
          >
            {{ t("settings.agent.consolidatePreview") }}
          </Button>
          <Button
            v-else
            variant="default"
            size="sm"
            :disabled="applyBusy || !previewResult || !previewResult.changedCount"
            @click="applyConsolidated"
          >
            {{ t("settings.agent.consolidateApply") }}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :disabled="previewBusy || applyBusy"
            @click="closeConsolidate"
          >
            {{ t("common.cancel") }}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    <!-- 删除备注二次确认（会落库的删除） -->
    <ConfirmDialog
      :open="pendingDelete != null"
      :title="pendingDelete?.scope === 'user' ? t('settings.agent.deleteUserNoteTitle') : t('settings.agent.deleteDeviceNoteTitle')"
      :description="t('settings.agent.deleteNoteDesc', { text: pendingDelete?.text ?? '' })"
      :confirm-label="t('common.delete')"
      :pending="deleteBusy"
      @update:open="(next) => { if (!next) pendingDelete = null; }"
      @confirm="removeNote"
    />

    <!-- 删除单条对话记忆 / 事实 -->
    <ConfirmDialog
      :open="pendingConvDelete != null"
      :title="pendingConvDelete?.kind === 'fact' ? t('memory.facts.deleteTitle') : t('memory.episodes.deleteTitle')"
      :description="pendingConvDelete?.text ?? ''"
      :confirm-label="t('memory.common.delete')"
      @update:open="(next) => { if (!next) pendingConvDelete = null; }"
      @confirm="confirmConversationDelete"
    />

    <!-- 清空对话记忆：文案明确设备备注与用户档案不受影响 -->
    <ConfirmDialog
      :open="pendingClear"
      :title="t('memory.settings.clearTitle')"
      :description="t('memory.settings.clearDesc')"
      :confirm-label="t('memory.settings.clearConfirm')"
      :pending="clearing"
      @update:open="(next) => { if (!next) pendingClear = false; }"
      @confirm="clearConversations"
    />
  </section>
</template>
