import { defineStore } from "pinia";
import { computed, ref } from "vue";

import type { ZenApi } from "@/types/zen-api";
import type {
  ExternalAgentClient,
  ExternalClientCapability,
  ExternalResumeBlocked,
  ExternalRunEvent,
  ExternalScanGroup,
  ExternalSessionSummary,
  ExternalTraceEvent,
} from "@zen/shared";

/** 主进程桥：类型与 apps/desktop/src/preload/external-sessions.ts、zen-api 的 externalSessions 段一致 */
type ExternalBridge = ZenApi["externalSessions"];

function bridge(): ExternalBridge | null {
  return window.zen?.externalSessions ?? null;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 主进程会给 summary 补 resumable / resumeBlocked；共享类型暂无声明时按可选字段读取 */
interface ResumeFlags {
  resumable?: boolean;
  resumeBlocked?: ExternalResumeBlocked;
}

function resumeFlags(session: ExternalSessionSummary): {
  resumable?: boolean;
  blocked?: ExternalResumeBlocked;
} {
  const extra = session as ExternalSessionSummary & ResumeFlags;
  return { resumable: extra.resumable, blocked: extra.resumeBlocked };
}

/**
 * 一次续聊的本地气泡：user 文本 + 流式累加的助手文本。
 * run 结束后由主进程推送 done/error/stopped 收尾，done 时再拉一次权威记录替换本地内容。
 */
interface LocalRun {
  id: string;
  runId: string;
  userText: string;
  assistantText: string;
  error: string;
  stopped: boolean;
  running: boolean;
  stopping: boolean;
}

export type ExternalSendResult =
  | { ok: true }
  | { ok: false; error?: string; blocked?: ExternalResumeBlocked };

/**
 * 外部 agent 会话：列表 + 轨迹 + 在原厂商会话里续聊。
 * 读路径以主进程为准；续聊只传「会话 id + 文本」，命令与参数由主进程固定。
 * 进度事件 external-sessions:run 由本 store 统一订阅，组件只读状态。
 */
export const useExternalSessionsStore = defineStore("externalSessions", () => {
  const sessions = ref<ExternalSessionSummary[]>([]);
  const groups = ref<ExternalScanGroup[]>([]);
  const capabilities = ref<ExternalClientCapability[]>([]);
  const skipped = ref(0);
  const loading = ref(false);
  const error = ref("");
  const clientFilter = ref<ExternalAgentClient | "all">("all");
  const query = ref("");
  const selectedId = ref("");
  const trace = ref<ExternalTraceEvent[]>([]);
  const traceLoading = ref(false);
  const traceTruncated = ref(false);
  const traceError = ref("");

  /** 当前这次续聊（同一时刻只跑一条） */
  const run = ref<LocalRun | null>(null);
  /** 失败时交还给输入框的原文；对象每次新建，组件靠引用变化触发回填 */
  const restoreDraft = ref<{ text: string } | null>(null);

  let unbindRun: (() => void) | null = null;

  /** 按客户端筛选 + 标题/目录搜索（本地过滤，不再回主进程扫一遍） */
  const filtered = computed(() => {
    const keyword = query.value.trim().toLowerCase();
    return sessions.value.filter((session) => {
      if (clientFilter.value !== "all" && session.client !== clientFilter.value) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return `${session.title} ${session.cwd ?? ""}`.toLowerCase().includes(keyword);
    });
  });

  const selected = computed(
    () => sessions.value.find((session) => session.id === selectedId.value) ?? null,
  );

  /** 只往「正在看的那个会话」里画流式气泡：切走再切回来仍能看到进行中的内容 */
  const activeRun = computed(() => (run.value?.id === selectedId.value ? run.value : null));

  const runningId = computed(() => (run.value?.running ? run.value.id : ""));

  /** 头部「当前厂商能力」看的是选中会话的客户端；没选中时看轨道筛选 */
  const currentClient = computed<ExternalAgentClient | null>(() => {
    if (selected.value) {
      return selected.value.client;
    }
    return clientFilter.value === "all" ? null : clientFilter.value;
  });

  const currentCapability = computed(
    () => capabilities.value.find((item) => item.client === currentClient.value) ?? null,
  );

  /** 侧栏/标题用的总数：只统计有会话的客户端 */
  const activeGroups = computed(() => groups.value.filter((group) => group.detected || group.count > 0));

  function capabilityOf(client: ExternalAgentClient): ExternalClientCapability | null {
    return capabilities.value.find((item) => item.client === client) ?? null;
  }

  function commandOf(client: ExternalAgentClient): string {
    return capabilityOf(client)?.command ?? client;
  }

  /** 能不能在这个会话里继续聊：主进程给了 resumable 就听它的，否则看客户端能力 */
  function canResume(id: string): boolean {
    const session = sessions.value.find((item) => item.id === id);
    if (!session) {
      return false;
    }
    const { resumable } = resumeFlags(session);
    if (resumable === true) {
      return true;
    }
    if (resumable === false) {
      return false;
    }
    return capabilityOf(session.client)?.resume === "supported";
  }

  /** 禁用原因：主进程标注优先，其次按客户端能力推断 */
  function resumeBlockedReason(id: string): ExternalResumeBlocked | null {
    if (canResume(id)) {
      return null;
    }
    const session = sessions.value.find((item) => item.id === id);
    if (!session) {
      return "unknown-session";
    }
    const { blocked } = resumeFlags(session);
    if (blocked) {
      return blocked;
    }
    return capabilityOf(session.client)?.resume === "missing-cli" ? "missing-cli" : "unsupported";
  }

  async function loadCapabilities(api: ExternalBridge): Promise<void> {
    if (typeof api.capabilities !== "function") {
      return;
    }
    try {
      capabilities.value = await api.capabilities();
    } catch {
      capabilities.value = [];
    }
  }

  async function load(): Promise<void> {
    const api = bridge();
    if (!api || loading.value) {
      return;
    }
    loading.value = true;
    error.value = "";
    try {
      const result = await api.list();
      sessions.value = result.sessions;
      groups.value = result.groups;
      skipped.value = result.skipped;
      // 选中的会话在刷新后消失时清掉选中，避免详情区停在已不存在的会话上
      if (selectedId.value && !result.sessions.some((item) => item.id === selectedId.value)) {
        clearSelection();
      }
    } catch (err) {
      error.value = message(err);
    } finally {
      loading.value = false;
    }
    await loadCapabilities(api);
    ensureRunSubscription(api);
  }

  /** 只重读轨迹（续聊 done 后替换本地流式内容） */
  async function refreshTrace(id: string): Promise<void> {
    const api = bridge();
    if (!api) {
      return;
    }
    try {
      const result = await api.trace(id);
      if (selectedId.value !== id) {
        return;
      }
      trace.value = result.events;
      traceTruncated.value = result.truncated;
      // 主进程读文件失败时返回 error：界面要说「读不到」，不能显示成「这个会话没有轨迹」
      traceError.value = result.error ?? "";
    } catch (err) {
      if (selectedId.value === id) {
        traceError.value = message(err);
      }
    }
  }

  async function select(id: string): Promise<void> {
    const api = bridge();
    if (!api || selectedId.value === id) {
      return;
    }
    selectedId.value = id;
    trace.value = [];
    traceError.value = "";
    traceTruncated.value = false;
    traceLoading.value = true;
    try {
      await refreshTrace(id);
    } finally {
      if (selectedId.value === id) {
        traceLoading.value = false;
      }
    }
  }

  function clearSelection(): void {
    selectedId.value = "";
    trace.value = [];
    traceLoading.value = false;
    traceTruncated.value = false;
    traceError.value = "";
  }

  function ensureRunSubscription(api: ExternalBridge): void {
    if (unbindRun || typeof api.onRun !== "function") {
      return;
    }
    unbindRun = api.onRun(handleRunEvent);
  }

  function handleRunEvent(event: ExternalRunEvent): void {
    const current = run.value;
    if (!current || current.runId !== event.runId) {
      return;
    }
    if (event.type === "started") {
      current.running = true;
      return;
    }
    if (event.type === "delta") {
      current.assistantText += event.text ?? "";
      return;
    }
    if (event.type === "error") {
      current.running = false;
      current.stopping = false;
      current.error = event.error || "run failed";
      // 原文回填输入框，用户改一下就能重发
      restoreDraft.value = { text: current.userText };
      return;
    }
    if (event.type === "stopped") {
      current.running = false;
      current.stopping = false;
      current.stopped = true;
      return;
    }
    // done：等权威记录到位再撤掉本地气泡，避免中间空一帧
    current.running = false;
    current.stopping = false;
    const id = current.id;
    void (async () => {
      if (id === selectedId.value) {
        await refreshTrace(id);
      }
      if (run.value === current) {
        run.value = null;
      }
      void load();
    })();
  }

  /**
   * 发一条续聊消息。返回 error 时输入框内容由组件保留；
   * blocked 表示该会话本来就不该发（按能力/会话文件判定）。
   */
  async function send(text: string): Promise<ExternalSendResult> {
    const api = bridge();
    const body = text.trim();
    if (!api) {
      return { ok: false, error: "window.zen.externalSessions unavailable" };
    }
    if (!selectedId.value) {
      return { ok: false, error: "no session selected" };
    }
    const id = selectedId.value;
    const blocked = resumeBlockedReason(id);
    if (blocked) {
      return { ok: false, blocked };
    }
    if (!body) {
      return { ok: false };
    }
    ensureRunSubscription(api);
    try {
      const result = await api.send({ id, message: body });
      if ("error" in result) {
        return {
          ok: false,
          error: result.error,
          blocked: result.blocked as ExternalResumeBlocked | undefined,
        };
      }
      run.value = {
        id,
        runId: result.runId,
        userText: body,
        assistantText: "",
        error: "",
        stopped: false,
        running: true,
        stopping: false,
      };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: message(err) };
    }
  }

  async function stop(): Promise<void> {
    const api = bridge();
    const current = run.value;
    if (!api || !current || !current.running || current.stopping) {
      return;
    }
    current.stopping = true;
    try {
      const result = await api.stop(current.runId);
      // 停止请求被受理就按已停止收尾：面板重新打开后（订阅已断开）也不会卡在「运行中」
      if (result?.ok !== false) {
        current.running = false;
        current.stopping = false;
        current.stopped = true;
      } else {
        current.stopping = false;
      }
    } catch {
      current.stopping = false;
    }
  }

  function clearRestoreDraft(): void {
    restoreDraft.value = null;
  }

  function setClientFilter(client: ExternalAgentClient | "all"): void {
    clientFilter.value = client;
  }

  /** 面板卸载时退订进度事件（列表与选中状态保留，重开沿用） */
  function dispose(): void {
    unbindRun?.();
    unbindRun = null;
  }

  return {
    sessions,
    groups,
    capabilities,
    activeGroups,
    skipped,
    loading,
    error,
    clientFilter,
    query,
    filtered,
    selectedId,
    selected,
    trace,
    traceLoading,
    traceTruncated,
    traceError,
    run,
    activeRun,
    runningId,
    restoreDraft,
    currentClient,
    currentCapability,
    load,
    select,
    clearSelection,
    refreshTrace,
    send,
    stop,
    canResume,
    resumeBlockedReason,
    capabilityOf,
    commandOf,
    clearRestoreDraft,
    setClientFilter,
    dispose,
  };
});
