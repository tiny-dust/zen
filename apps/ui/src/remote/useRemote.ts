import { computed, onMounted, onUnmounted, shallowRef } from "vue";

type Session = { id: string; title: string; state: string; updatedAt?: string };
type Message = { id: string; role: string; content: string; createdAt?: string };
type SessionDetail = { session: Session; messages: Message[] };
type BrowserEvent = { type?: string; role?: string; delta?: string; text?: string };

class RequestError extends Error {
  constructor(public readonly status: number) {
    super(status === 401 || status === 403 ? "配对已失效，请重新配对。" : `请求失败（${status}），请稍后重试。`);
  }
}

function request<T>(path: string): Promise<T>;
function request(path: string, body: object): Promise<void>;
async function request(path: string, body?: object): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: body ? "POST" : "GET",
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error("无法连接远程服务，请检查网络后重试。");
  }
  if (!response.ok) throw new RequestError(response.status);
  if (body) return;
  return response.json();
}

function visibleMessages(messages: Message[]): Message[] {
  return messages.filter((message) =>
    (message.role === "user" || message.role === "assistant") && typeof message.content === "string",
  );
}

export function useRemote() {
  const paired = shallowRef(false);
  const online = shallowRef(false);
  const loading = shallowRef(true);
  const busy = shallowRef(false);
  const error = shallowRef("");
  const sessions = shallowRef<Session[]>([]);
  const selectedId = shallowRef<string | null>(null);
  const selectedSession = shallowRef<Session | null>(null);
  const messages = shallowRef<Message[]>([]);
  const connected = shallowRef(false);
  const selected = computed(() => sessions.value.find((session) => session.id === selectedId.value) ?? selectedSession.value);

  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let snapshotVersion = 0;
  let streamId = 0;
  let pendingEvents: { sessionId: string; event: BrowserEvent }[] | null = null;
  let syncing = false;
  let syncAgain = false;

  function fail(cause: unknown) {
    if (disposed) return;
    if (cause instanceof RequestError && (cause.status === 401 || cause.status === 403)) {
      paired.value = false;
      online.value = false;
      connected.value = false;
      sessions.value = [];
      selectedId.value = null;
      selectedSession.value = null;
      messages.value = [];
      snapshotVersion++;
      socket?.close();
      socket = null;
    }
    error.value = cause instanceof Error ? cause.message : "操作失败，请重试。";
  }

  async function refreshStatus() {
    const status = await request<{ online: boolean; paired: boolean }>("/api/status");
    if (disposed) return;
    paired.value = status.paired === true;
    online.value = status.online === true;
    if (!paired.value) {
      sessions.value = [];
      selectedId.value = null;
      selectedSession.value = null;
      messages.value = [];
      socket?.close();
    }
  }

  async function refreshSessions() {
    const result = await request<{ sessions: Session[] }>("/api/sessions");
    if (!disposed) sessions.value = Array.isArray(result.sessions) ? result.sessions : [];
  }

  async function selectSession(id: string) {
    selectedId.value = id;
    selectedSession.value = sessions.value.find((session) => session.id === id) ?? null;
    messages.value = [];
    await refreshSession(id);
  }

  async function refreshSession(id = selectedId.value) {
    if (!id) return;
    const version = ++snapshotVersion;
    try {
      const detail = await request<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}`);
      if (disposed || version !== snapshotVersion || id !== selectedId.value) return;
      selectedSession.value = detail.session;
      messages.value = visibleMessages(Array.isArray(detail.messages) ? detail.messages : []);
      error.value = "";
    } catch (cause) {
      if (version === snapshotVersion) fail(cause);
    }
  }

  function applyEvent(event: BrowserEvent) {
    if (event.type === "delta" && (!event.role || event.role === "assistant")) {
      const delta = typeof event.delta === "string" ? event.delta : typeof event.text === "string" ? event.text : "";
      if (!delta) return;
      const last = messages.value.at(-1);
      if (last?.id === `stream-${streamId}`) {
        messages.value = [...messages.value.slice(0, -1), { ...last, content: last.content + delta }];
      } else {
        streamId++;
        messages.value = [...messages.value, { id: `stream-${streamId}`, role: "assistant", content: delta }];
      }
    } else if (event.type === "done") {
      void refreshSession();
      void refreshSessions().catch(fail);
    }
  }

  async function syncSnapshot(current: WebSocket) {
    if (disposed || socket !== current || !paired.value || !online.value) return;
    if (syncing) {
      syncAgain = true;
      return;
    }
    syncing = true;
    pendingEvents = [];
    try {
      await refreshSessions();
      await refreshSession();
      // Replay only events for the still-selected conversation after the snapshot.
      const queued = pendingEvents;
      if (socket === current) queued?.forEach(({ sessionId, event }) => {
        if (sessionId === selectedId.value) applyEvent(event);
      });
    } catch (cause) {
      fail(cause);
    } finally {
      pendingEvents = null;
      syncing = false;
      if (syncAgain) {
        syncAgain = false;
        void syncSnapshot(current);
      }
    }
  }

  function connect() {
    if (disposed || !paired.value || socket) return;
    const scheme = location.protocol === "https:" ? "wss:" : "ws:";
    const current = new WebSocket(`${scheme}//${location.host}/ws/browser`);
    socket = current;
    current.onopen = () => {
      if (disposed || socket !== current) return;
      connected.value = true;
      void syncSnapshot(current);
    };
    current.onmessage = (message) => {
      if (disposed || socket !== current) return;
      try {
        const frame: unknown = JSON.parse(String(message.data));
        if (!frame || typeof frame !== "object" || !("type" in frame)) return;
        if (frame.type === "status" && "online" in frame) {
          const wasOnline = online.value;
          online.value = frame.online === true;
          if (online.value && !wasOnline) void syncSnapshot(current);
        } else if (frame.type === "event" && "sessionId" in frame && typeof frame.sessionId === "string" && frame.sessionId === selectedId.value && "event" in frame) {
          const event = frame.event;
          if (!event || typeof event !== "object" || !("type" in event)) return;
          const safeEvent = event as BrowserEvent;
          if (pendingEvents) pendingEvents.push({ sessionId: frame.sessionId, event: safeEvent });
          else applyEvent(safeEvent);
        }
      } catch {
        // Ignore malformed frames; the next snapshot restores authoritative state.
      }
    };
    current.onclose = () => {
      if (socket !== current) return;
      socket = null;
      connected.value = false;
      pendingEvents = null;
      if (!disposed && paired.value) {
        void refreshStatus().catch(fail);
        reconnectTimer = setTimeout(connect, 2000);
      }
    };
    current.onerror = () => current.close();
  }

  async function start() {
    loading.value = true;
    error.value = "";
    try {
      await refreshStatus();
      if (paired.value) {
        connect();
        if (online.value) {
          await refreshSessions();
          if (selectedId.value) await refreshSession();
        }
      }
    } catch (cause) {
      fail(cause);
    } finally {
      loading.value = false;
    }
  }

  async function pair(code: string) {
    busy.value = true;
    error.value = "";
    try {
      await request("/api/pair", { code });
      await start();
    } catch (cause) {
      fail(cause);
    } finally {
      busy.value = false;
    }
  }

  async function send(text: string): Promise<boolean> {
    const id = selectedId.value;
    if (!id || !paired.value || !online.value || !text.trim()) return false;
    busy.value = true;
    error.value = "";
    try {
      await request(`/api/sessions/${encodeURIComponent(id)}/messages`, { text: text.trim() });
      await refreshSession(id);
      await refreshSessions();
      return true;
    } catch (cause) {
      fail(cause);
      return false;
    } finally {
      busy.value = false;
    }
  }

  onMounted(start);
  onUnmounted(() => {
    disposed = true;
    clearTimeout(reconnectTimer);
    socket?.close();
  });

  return { paired, online, loading, busy, error, sessions, selected, selectedId, messages, connected, start, pair, selectSession, send };
}
