import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import RemoteApp from "./RemoteApp.vue";

class MockSocket {
  static instances: MockSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public readonly url: string) { MockSocket.instances.push(this); }
  close() { this.onclose?.(); }
  emit(frame: object) { this.onmessage?.({ data: JSON.stringify(frame) }); }
}

const session = { id: "s1", title: "项目讨论", state: "idle", updatedAt: "2026-11-23T08:00:00Z" };
let snapshot = [{ id: "m1", role: "assistant", content: "旧消息" }];
async function fetchResponse(path: string) {
  if (path === "/api/status") return { ok: true, json: async () => ({ paired: true, online: true }) };
  if (path === "/api/sessions") return { ok: true, json: async () => ({ sessions: [session] }) };
  if (path === "/api/sessions/s1") return { ok: true, json: async () => ({ session, messages: snapshot }) };
  throw new Error(`Unexpected request: ${path}`);
}
const fetchMock = vi.fn<(path: string, options?: RequestInit) => Promise<{ ok: boolean; status?: number; json?: () => Promise<unknown> }>>(fetchResponse);

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", MockSocket);
  MockSocket.instances = [];
  snapshot = [{ id: "m1", role: "assistant", content: "旧消息" }];
  fetchMock.mockReset();
  fetchMock.mockImplementation(fetchResponse);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("remote conversation", () => {
  it("pairs with a code even when the POST response has no JSON body", async () => {
    let paired = false;
    fetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/status") return { ok: true, json: async () => ({ paired, online: true }) };
      if (path === "/api/pair") { paired = true; return { ok: true, status: 204 }; }
      if (path === "/api/sessions") return { ok: true, json: async () => ({ sessions: [session] }) };
      throw new Error(`Unexpected request: ${path}`);
    });
    const wrapper = mount(RemoteApp);
    await flushPromises();
    await wrapper.find("#pair-code").setValue("123456");
    await wrapper.find(".remote-pair-form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("项目讨论");
    expect(fetchMock).toHaveBeenCalledWith("/api/pair", expect.objectContaining({ credentials: "include", body: JSON.stringify({ code: "123456" }) }));
    wrapper.unmount();
  });

  it("connects while the device is offline and loads sessions when it comes online", async () => {
    let online = false;
    fetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/status") return { ok: true, json: async () => ({ paired: true, online }) };
      if (path === "/api/sessions") {
        if (!online) return { ok: false, status: 503 };
        return { ok: true, json: async () => ({ sessions: [session] }) };
      }
      throw new Error(`Unexpected request: ${path}`);
    });
    const wrapper = mount(RemoteApp);
    await flushPromises();
    expect(wrapper.text()).toContain("设备离线");
    expect(MockSocket.instances).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/sessions", expect.anything());
    const socket = MockSocket.instances[0];
    socket.onopen?.();
    await flushPromises();
    online = true;
    socket.emit({ type: "status", online: true });
    await flushPromises();
    expect(wrapper.text()).toContain("项目讨论");
    wrapper.unmount();
  });

  it("returns to pairing when the relay revokes the browser cookie", async () => {
    let paired = true;
    fetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/status") return { ok: true, json: async () => ({ paired, online: true }) };
      return fetchResponse(path);
    });
    const wrapper = mount(RemoteApp);
    await flushPromises();
    expect(wrapper.text()).toContain("项目讨论");
    paired = false;
    MockSocket.instances[0].close();
    await flushPromises();
    expect(wrapper.text()).toContain("输入桌面端显示的配对码");
    expect(wrapper.text()).not.toContain("项目讨论");
    wrapper.unmount();
  });

  it("does not send while Enter confirms an IME composition", async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === "/api/sessions/s1/messages") return { ok: true, status: 200 };
      return fetchResponse(path);
    });
    const wrapper = mount(RemoteApp);
    await flushPromises();
    await wrapper.find(".remote-session").trigger("click");
    await flushPromises();
    await wrapper.find("textarea").setValue("输入中");
    await wrapper.find("textarea").trigger("keydown", { key: "Enter", isComposing: true });
    await flushPromises();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/sessions/s1/messages", expect.anything());
    expect((wrapper.find("textarea").element as HTMLTextAreaElement).value).toBe("输入中");
    await wrapper.find("textarea").trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/s1/messages", expect.objectContaining({ body: JSON.stringify({ text: "输入中" }) }));
    wrapper.unmount();
  });

  it("marks the device offline and restores the selected conversation from a snapshot after reconnect", async () => {
    vi.useFakeTimers();
    const wrapper = mount(RemoteApp);
    await flushPromises();
    expect(wrapper.text()).toContain("项目讨论");
    await wrapper.find(".remote-session").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("旧消息");

    const socket = MockSocket.instances[0];
    socket.onopen?.();
    await flushPromises();
    socket.emit({ type: "status", online: false });
    await flushPromises();
    expect(wrapper.text()).toContain("设备离线");
    expect(wrapper.find("textarea").attributes("disabled")).toBeDefined();

    socket.close();
    snapshot = [{ id: "m2", role: "assistant", content: "断线期间的新消息" }, { id: "secret", role: "tool", content: "敏感工具输出" }];
    await vi.advanceTimersByTimeAsync(2000);
    const restored = MockSocket.instances[1];
    restored.onopen?.();
    restored.emit({ type: "status", online: true });
    await flushPromises();
    expect(wrapper.text()).toContain("断线期间的新消息");
    expect(wrapper.text()).not.toContain("敏感工具输出");
    restored.emit({ type: "event", seq: 3, sessionId: "s1", event: { type: "delta", delta: "增量回复" } });
    await flushPromises();
    expect(wrapper.text()).toContain("增量回复");
    snapshot = [{ id: "m3", role: "assistant", content: "完整回复" }];
    restored.emit({ type: "event", seq: 4, sessionId: "s1", event: { type: "done" } });
    await flushPromises();
    expect(wrapper.text()).toContain("完整回复");
    expect(wrapper.text()).not.toContain("增量回复");
    expect(fetchMock).toHaveBeenCalledWith("/api/sessions/s1", expect.objectContaining({ credentials: "include" }));
    await wrapper.find('[aria-label="返回会话列表"]').trigger("click");
    expect(wrapper.text()).toContain("最近的会话");
    wrapper.unmount();
  });
});
