import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RemoteApp from "./RemoteApp.vue";

class MockSocket {
  static instances: MockSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  sent: object[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public readonly url: string) { MockSocket.instances.push(this); }
  open() { this.readyState = 1; this.onopen?.(); }
  close() { this.readyState = 3; this.onclose?.(); }
  send(frame: string) { this.sent.push(JSON.parse(frame)); }
  emit(frame: object) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}

const session = { id: "s1", title: "项目讨论", state: "idle" };
const devices = [{ id: "d1", name: "Laptop", online: true }, { id: "d2", name: "Desktop", online: false }];
let authenticated = false;
let snapshot = [{ id: "m1", role: "assistant", content: "旧消息" }];
let statusDeviceId: string | undefined = "d1";
const fetchResponse = async (path: string, options?: RequestInit): Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }> => {
  const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
  if (path === "/api/devices") return ok({ devices });
  if (path === "/api/status") return ok({ paired: authenticated, online: true, deviceId: statusDeviceId });
  if (path === "/api/login") {
    const input = JSON.parse(String(options?.body));
    if (input.password !== "correct") return { ok: false, status: 403, json: async () => ({}) };
    authenticated = true;
    statusDeviceId = input.deviceId;
    return ok({ ok: true });
  }
  if (path === "/api/sessions" && options?.method === "POST") return ok({ session });
  if (path === "/api/sessions") return ok({ sessions: [session], workspaces: [{ id: "common", name: "公共区" }] });
  if (path === "/api/sessions/s1") return ok({ session, messages: snapshot });
  if (path === "/api/sessions/s1/messages") return ok({ ok: true });
  throw new Error(`Unexpected request: ${path}`);
};
const fetchMock = vi.fn(fetchResponse);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", MockSocket);
  MockSocket.instances = [];
  authenticated = false;
  statusDeviceId = "d1";
  snapshot = [{ id: "m1", role: "assistant", content: "旧消息" }];
  fetchMock.mockReset();
  fetchMock.mockImplementation(fetchResponse);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

async function login(wrapper: ReturnType<typeof mount>, password = "correct") {
  await wrapper.findAll(".remote-device")[0]!.trigger("click");
  await wrapper.find("#remote-username").setValue("user");
  await wrapper.find("#remote-password").setValue(password);
  await wrapper.find(".remote-pair-form").trigger("submit");
  await flushPromises();
}

describe("remote device login and conversation", () => {
  it("lists devices first, logs in with a cookie, and keeps failed login on the login page", async () => {
    const wrapper = mount(RemoteApp);
    await flushPromises();
    expect(wrapper.text()).toContain("Laptop · 在线");
    expect(wrapper.text()).toContain("Desktop · 离线");
    expect(wrapper.find("#remote-password").attributes("type")).toBe("password");
    await login(wrapper, "wrong");
    expect(wrapper.text()).toContain("登录已失效");
    expect(wrapper.find(".remote-pair-form").exists()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/sessions", expect.anything());
    await wrapper.find("#remote-password").setValue("correct");
    await wrapper.find(".remote-pair-form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("项目讨论");
    expect(fetchMock).toHaveBeenCalledWith("/api/login", expect.objectContaining({ credentials: "include", body: JSON.stringify({ deviceId: "d1", username: "user", password: "correct" }) }));
    wrapper.unmount();
  });

  it("does not restore a cookie when status cannot identify its device", async () => {
    authenticated = true;
    statusDeviceId = undefined;
    const wrapper = mount(RemoteApp);
    await flushPromises();
    expect(wrapper.find(".remote-pair-form").exists()).toBe(true);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/sessions", expect.anything());
    wrapper.unmount();
  });

  it("loads paginated sessions and earlier messages without displaying private roles", async () => {
    authenticated = true;
    fetchMock.mockImplementation(async (path: string) => {
      const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => data });
      if (path === "/api/devices") return ok({ devices });
      if (path === "/api/status") return ok({ paired: true, online: true, deviceId: "d1" });
      if (path === "/api/sessions") return ok({ sessions: [session], workspaces: [{ id: "common", name: "公共区" }], nextCursor: "1" });
      if (path === "/api/sessions?cursor=1") return ok({ sessions: [{ id: "s2", title: "第二页", state: "idle" }], workspaces: [] });
      if (path === "/api/sessions/s1") return ok({ session, messages: snapshot, nextCursor: "1" });
      if (path === "/api/sessions/s1?cursor=1") return ok({ session, messages: [{ id: "old", role: "user", content: "更早的提问" }, { id: "tool", role: "tool", content: "私密工具输出" }], nextCursor: null });
      throw new Error(`Unexpected request: ${path}`);
    });
    const wrapper = mount(RemoteApp);
    await flushPromises();
    expect(wrapper.text()).toContain("第二页");
    await wrapper.find(".remote-session").trigger("click");
    await flushPromises();
    await wrapper.findAll("button").find((button) => button.text() === "加载更早")!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("更早的提问");
    expect(wrapper.text()).not.toContain("私密工具输出");
    wrapper.unmount();
  });

  it("assembles >40KB latest and archived older messages before rendering, without leaking private roles", async () => {
    authenticated = true;
    const latest = `${"中".repeat(21_000)}😀结束`;
    const older = `${"旧".repeat(22_000)}😀开头`;
    const pages = new Map<string, object>([
      ["/api/sessions/s1", { session, messages: [{ id: "new", role: "assistant", content: latest.slice(12_000), offset: 12_000, totalLength: latest.length }], nextCursor: "2:12000" }],
      ["/api/sessions/s1?cursor=2%3A12000", { session, messages: [{ id: "new", role: "assistant", content: latest.slice(0, 12_000), offset: 0, totalLength: latest.length }], nextCursor: "1" }],
      ["/api/sessions/s1?cursor=1", { session, messages: [{ id: "old", role: "user", content: older.slice(12_000), offset: 12_000, totalLength: older.length }, { id: "private", role: "tool", content: "secret" }], nextCursor: "1:12000" }],
      ["/api/sessions/s1?cursor=1%3A12000", { session, messages: [{ id: "old", role: "user", content: older.slice(0, 12_000), offset: 0, totalLength: older.length }], nextCursor: null }],
    ]);
    fetchMock.mockImplementation(async (path: string, options?: RequestInit) => {
      if (pages.has(path)) return { ok: true, status: 200, json: async () => pages.get(path) };
      return fetchResponse(path, options);
    });
    const wrapper = mount(RemoteApp);
    await flushPromises();
    await wrapper.find(".remote-session").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain(latest);
    expect(wrapper.text()).not.toContain(older);
    expect(wrapper.text()).not.toContain("secret");
    await wrapper.findAll("button").find((button) => button.text() === "加载更早")!.trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain(older);
    expect(wrapper.text()).toContain(latest);
    expect(wrapper.findAll(".remote-message")).toHaveLength(2);
    wrapper.unmount();
  });

  it("subscribes after selection, unsubscribes on leave, and restores the snapshot on reconnect", async () => {
    vi.useFakeTimers();
    authenticated = true;
    const wrapper = mount(RemoteApp);
    await flushPromises();
    const socket = MockSocket.instances[0]!;
    socket.open();
    await flushPromises();
    await wrapper.find(".remote-session").trigger("click");
    await flushPromises();
    expect(socket.sent).toContainEqual({ type: "subscribe", sessionId: "s1" });
    socket.emit({ type: "event", sessionId: "s1", event: { type: "status", status: "running" } });
    socket.emit({ type: "event", sessionId: "s1", event: { type: "delta", text: "增量回复" } });
    await flushPromises();
    expect(wrapper.text()).toContain("增量回复");
    expect(wrapper.text()).toContain("正在生成");
    socket.close();
    snapshot = [{ id: "m2", role: "assistant", content: "断线后的完整回复" }];
    await vi.advanceTimersByTimeAsync(2000);
    const restored = MockSocket.instances[1]!;
    restored.open();
    await flushPromises();
    expect(restored.sent).toContainEqual({ type: "subscribe", sessionId: "s1" });
    expect(wrapper.text()).toContain("断线后的完整回复");
    expect(wrapper.text()).not.toContain("增量回复");
    await wrapper.find('[aria-label="返回会话列表"]').trigger("click");
    expect(restored.sent).toContainEqual({ type: "subscribe", sessionId: null });
    wrapper.unmount();
  });

  it("creates and selects a session, and clears local data when switching devices", async () => {
    authenticated = true;
    const wrapper = mount(RemoteApp);
    await flushPromises();
    await wrapper.findAll("button").find((button) => button.text() === "新建会话")!.trigger("click");
    await flushPromises();
    expect(wrapper.find("textarea").exists()).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions", expect.objectContaining({ body: JSON.stringify({ workspaceId: "common" }) }));
    await wrapper.find('[aria-label="返回会话列表"]').trigger("click");
    await wrapper.find(".remote-switch").trigger("click");
    expect(wrapper.text()).not.toContain("项目讨论");
    expect(wrapper.find(".remote-pair-form").exists()).toBe(true);
    wrapper.unmount();
  });
});
