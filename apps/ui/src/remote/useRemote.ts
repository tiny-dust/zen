import { computed, onMounted, onUnmounted, shallowRef } from "vue";

type Device = { id: string; name: string; online: boolean };
type Workspace = { id: string; name: string };
type Session = { id: string; title: string; state: string; updatedAt?: string; workspaceId?: string };
type Message = { id: string; role: string; content: string; createdAt?: string; offset?: number; totalLength?: number };
type SessionDetail = { session: Session; messages: Message[]; nextCursor?: string | null };
type BrowserEvent = { type?: string; status?: string; delta?: string; text?: string };

class RequestError extends Error {
  constructor(public readonly status: number) {
    super(status === 401 || status === 403 ? "登录已失效，请重新登录。" : `请求失败（${status}），请稍后重试。`);
  }
}

function request<T>(path: string): Promise<T>;
function request<T = void>(path: string, body: object): Promise<T>;
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
  return response.status === 204 ? undefined : response.json();
}

function visibleMessages(messages: Message[]): Message[] {
  return messages.filter((message) =>
    (message.role === "user" || message.role === "assistant") && typeof message.content === "string",
  );
}

function mergePage(page: Message[], loaded: Message[]): Message[] {
  const incoming = visibleMessages(page);
  const tail = incoming.at(-1);
  const head = loaded[0];
  if (tail && head && tail.id === head.id) {
    const offset = tail.offset ?? 0;
    if (tail.totalLength !== head.totalLength || offset + tail.content.length !== (head.offset ?? 0)) {
      throw new Error("消息分块不连续，请重新打开会话。");
    }
    incoming[incoming.length - 1] = { ...tail, content: tail.content + head.content, offset };
    loaded = loaded.slice(1);
  } else if (head && (head.offset ?? 0) > 0) {
    throw new Error("消息分块缺失，请重新打开会话。");
  }
  const result = [...incoming, ...loaded];
  if (result.some((message, index) => index > 0 && message.id === result[index - 1]?.id)) {
    throw new Error("消息分页重复，请稍后重试。");
  }
  return result;
}

export function useRemote() {
  const devices = shallowRef<Device[]>([]);
  const deviceId = shallowRef<string | null>(null);
  const paired = shallowRef(false);
  const online = shallowRef(false);
  const loading = shallowRef(true);
  const busy = shallowRef(false);
  const error = shallowRef("");
  const sessions = shallowRef<Session[]>([]);
  const workspaces = shallowRef<Workspace[]>([]);
  const workspaceId = shallowRef("common");
  const selectedId = shallowRef<string | null>(null);
  const selectedSession = shallowRef<Session | null>(null);
  const messages = shallowRef<Message[]>([]);
  const olderCursor = shallowRef<string | null>(null);
  const loadingOlder = shallowRef(false);
  const generating = shallowRef(false);
  const generationStatus = shallowRef("");
  const connected = shallowRef(false);
  const selected = computed(() => sessions.value.find((session) => session.id === selectedId.value) ?? selectedSession.value);

  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let version = 0;
  let streamId = 0;
  let pendingEvents: { sessionId: string; event: BrowserEvent }[] | null = null;
  let syncing = false;
  let syncAgain = false;
  let olderLoading = false;
  let choosingDevice = false;

  function clearSession() {
    version++;
    paired.value = false;
    deviceId.value = null;
    online.value = false;
    connected.value = false;
    sessions.value = [];
    workspaces.value = [];
    workspaceId.value = "common";
    selectedId.value = null;
    selectedSession.value = null;
    messages.value = [];
    olderCursor.value = null;
    generating.value = false;
    generationStatus.value = "";
    pendingEvents = null;
    clearTimeout(reconnectTimer);
    const previous = socket;
    socket = null;
    previous?.close();
  }

  function fail(cause: unknown) {
    if (disposed) return;
    if (cause instanceof RequestError && cause.status === 401) clearSession();
    error.value = cause instanceof Error ? cause.message : "操作失败，请重试。";
  }

  async function refreshStatus(expectedId = deviceId.value) {
    const status = await request<{ online: boolean; paired: boolean; deviceId?: string }>("/api/status");
    if (disposed || !expectedId || expectedId !== deviceId.value) return;
    // A status without deviceId cannot prove that the cookie belongs to the selected device.
    if (!status.paired || status.deviceId !== expectedId) {
      clearSession();
      return;
    }
    paired.value = true;
    online.value = status.online === true;
  }

  async function refreshSessions() {
    const generation = version;
    const id = deviceId.value;
    const all: Session[] = [];
    const names = new Map<string, Workspace>();
    const seen = new Set<string>();
    let cursor: string | undefined;
    while (true) {
      const result = await request<{ sessions: Session[]; workspaces: Workspace[]; nextCursor?: string | null }>(
        `/api/sessions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (disposed || generation !== version || id !== deviceId.value) return;
      if (Array.isArray(result.sessions)) all.push(...result.sessions);
      if (Array.isArray(result.workspaces)) for (const workspace of result.workspaces) {
        if (typeof workspace.id === "string" && typeof workspace.name === "string") names.set(workspace.id, workspace);
      }
      const next = result.nextCursor;
      if (!next) {
        sessions.value = [...new Map(all.map((session) => [session.id, session])).values()];
        workspaces.value = [...names.values()];
        return;
      }
      if (seen.has(next)) throw new Error("会话分页重复，请稍后重试。");
      seen.add(next);
      cursor = next;
    }
  }

  function subscribe(id: string | null) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "subscribe", sessionId: id }));
  }

  function leaveSession() {
    subscribe(null);
    version++;
    selectedId.value = null;
    selectedSession.value = null;
    messages.value = [];
    olderCursor.value = null;
    generating.value = false;
    generationStatus.value = "";
  }

  async function selectSession(id: string) {
    if (selectedId.value === id) return;
    selectedId.value = id;
    selectedSession.value = sessions.value.find((session) => session.id === id) ?? null;
    messages.value = [];
    olderCursor.value = null;
    generating.value = false;
    generationStatus.value = "";
    subscribe(id);
    await refreshSession(id);
  }

  async function fetchMessagePage(id: string, initialCursor: string | null, generation: number, existing: Message[]) {
    let cursor = initialCursor;
    let loaded = existing;
    const seen = new Set<string>();
    let detail: SessionDetail;
    while (true) {
      detail = await request<SessionDetail>(`/api/sessions/${encodeURIComponent(id)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (disposed || generation !== version || id !== selectedId.value) return null;
      loaded = mergePage(Array.isArray(detail.messages) ? detail.messages : [], loaded);
      const next = detail.nextCursor || null;
      if (next && (next === cursor || seen.has(next))) throw new Error("消息分页重复，请稍后重试。");
      if (!(loaded[0]?.offset ?? 0)) return { detail, loaded, cursor: next };
      if (!next) throw new Error("消息分块缺失，请重新打开会话。");
      seen.add(next);
      cursor = next;
    }
  }

  async function refreshSession(id = selectedId.value) {
    if (!id) return;
    const generation = ++version;
    try {
      const result = await fetchMessagePage(id, null, generation, []);
      if (!result) return;
      selectedSession.value = result.detail.session;
      messages.value = result.loaded;
      olderCursor.value = result.cursor;
      generating.value = result.detail.session.state === "running" || result.detail.session.state === "busy";
      if (!generating.value) generationStatus.value = "";
      error.value = "";
    } catch (cause) {
      if (generation === version) fail(cause);
    }
  }

  async function loadOlder() {
    const id = selectedId.value;
    const cursor = olderCursor.value;
    if (!id || !cursor || olderLoading) return;
    olderLoading = true;
    loadingOlder.value = true;
    const generation = version;
    try {
      const result = await fetchMessagePage(id, cursor, generation, messages.value);
      if (!result) return;
      messages.value = result.loaded;
      olderCursor.value = result.cursor;
      error.value = "";
    } catch (cause) {
      if (generation === version) fail(cause);
    } finally {
      olderLoading = false;
      loadingOlder.value = false;
    }
  }

  function applyEvent(event: BrowserEvent) {
    if (event.type === "status" && typeof event.status === "string") {
      generating.value = true;
      generationStatus.value = event.status === "running" ? "正在生成…" : "正在处理…";
    } else if (event.type === "delta") {
      const delta = typeof event.text === "string" ? event.text : typeof event.delta === "string" ? event.delta : "";
      if (!delta) return;
      generating.value = true;
      generationStatus.value = "正在生成…";
      const last = messages.value.at(-1);
      if (last?.id === `stream-${streamId}`) {
        messages.value = [...messages.value.slice(0, -1), { ...last, content: last.content + delta }];
      } else {
        streamId++;
        messages.value = [...messages.value, { id: `stream-${streamId}`, role: "assistant", content: delta }];
      }
    } else if (event.type === "done") {
      generating.value = false;
      generationStatus.value = "";
      void refreshSession();
      void refreshSessions().catch(fail);
    }
  }

  async function syncSnapshot(current: WebSocket) {
    if (disposed || socket !== current || !paired.value || !online.value) return;
    if (syncing) { syncAgain = true; return; }
    syncing = true;
    pendingEvents = [];
    try {
      await refreshSessions();
      await refreshSession();
      const queued = pendingEvents;
      if (socket === current && queued) queued.forEach(({ sessionId, event }) => {
        if (sessionId === selectedId.value) applyEvent(event);
      });
    } catch (cause) {
      fail(cause);
    } finally {
      pendingEvents = null;
      syncing = false;
      if (syncAgain) { syncAgain = false; void syncSnapshot(current); }
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
      subscribe(selectedId.value);
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
        } else if (frame.type === "event" && "sessionId" in frame && frame.sessionId === selectedId.value && "event" in frame) {
          const event = frame.event;
          if (!event || typeof event !== "object" || !("type" in event)) return;
          const safeEvent = event as BrowserEvent;
          if (pendingEvents && typeof frame.sessionId === "string") pendingEvents.push({ sessionId: frame.sessionId, event: safeEvent });
          else applyEvent(safeEvent);
        }
      } catch {
        // A malformed frame cannot update the UI; reconnect restores the snapshot.
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
      const result = await request<{ devices: Device[] }>("/api/devices");
      if (disposed) return;
      devices.value = Array.isArray(result.devices) ? result.devices : [];
      const status = await request<{ online: boolean; paired: boolean; deviceId?: string }>("/api/status");
      if (disposed || choosingDevice) return;
      if (status.paired && status.deviceId && devices.value.some((device) => device.id === status.deviceId)) {
        if (deviceId.value && deviceId.value !== status.deviceId) clearSession();
        deviceId.value = status.deviceId;
        paired.value = true;
        online.value = status.online === true;
        connect();
        if (online.value) {
          await refreshSessions();
          await refreshSession();
        }
      } else if (paired.value) clearSession();
    } catch (cause) {
      fail(cause);
    } finally {
      loading.value = false;
    }
  }

  async function login(id: string, username: string, password: string) {
    if (!devices.value.some((device) => device.id === id)) return;
    busy.value = true;
    error.value = "";
    clearSession();
    try {
      await request("/api/login", { deviceId: id, username, password });
      if (disposed) return;
      deviceId.value = id;
      await refreshStatus(id);
      if (!paired.value) throw new Error("无法确认设备登录状态，请重试。");
      choosingDevice = false;
      connect();
      if (online.value) await refreshSessions();
    } catch (cause) {
      clearSession();
      fail(cause);
    } finally {
      busy.value = false;
    }
  }

  function switchDevice() {
    choosingDevice = true;
    clearSession();
    error.value = "";
  }

  async function createSession() {
    if (!paired.value || !online.value || busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      const result = await request<{ session: Session }>("/api/sessions", { workspaceId: workspaceId.value });
      if (!result.session?.id) throw new Error("创建会话失败，请重试。");
      sessions.value = [result.session, ...sessions.value.filter((item) => item.id !== result.session.id)];
      await selectSession(result.session.id);
      await refreshSessions();
    } catch (cause) {
      fail(cause);
    } finally {
      busy.value = false;
    }
  }

  async function send(text: string): Promise<boolean> {
    const id = selectedId.value;
    if (!id || !paired.value || !online.value || !text.trim() || busy.value) return false;
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
    clearSession();
  });

  return { devices, deviceId, paired, online, loading, busy, error, sessions, workspaces, workspaceId, selected, selectedId,
    messages, olderCursor, loadingOlder, generating, generationStatus, connected, start, login, switchDevice,
    leaveSession, selectSession, loadOlder, createSession, send };
}
