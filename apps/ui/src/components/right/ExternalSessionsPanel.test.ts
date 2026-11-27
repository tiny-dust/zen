import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { i18n } from "@/locales";

import ExternalSessionsPanel from "./ExternalSessionsPanel.vue";

import type {
  ExternalClientCapability,
  ExternalRunEvent,
  ExternalRunRequest,
  ExternalSessionSummary,
  ExternalSessionTrace,
} from "@zen/shared";

const CAPABILITIES: ExternalClientCapability[] = [
  { client: "claude", command: "claude", path: "/usr/local/bin/claude", resume: "supported" },
  { client: "codex", command: "codex", path: "/usr/local/bin/codex", resume: "supported" },
  { client: "gemini", command: "gemini", path: null, resume: "missing-cli" },
  { client: "dsh", command: "dsh", path: null, resume: "missing-cli" },
  { client: "grok", command: "grok", path: "/usr/local/bin/grok", resume: "unsupported" },
];

function summary(id: string, client: ExternalSessionSummary["client"] = "claude"): ExternalSessionSummary {
  return {
    id,
    client,
    sessionId: id.split(":")[1] ?? id,
    title: `title ${id}`,
    updatedAt: Date.now(),
    status: "unverified",
    eventCount: 2,
    path: `/tmp/${id}.jsonl`,
  };
}

interface StubOptions {
  sessions?: ExternalSessionSummary[];
  trace?: (id: string) => Promise<ExternalSessionTrace>;
  send?: (request: ExternalRunRequest) => Promise<{ runId: string } | { error: string; blocked?: string }>;
}

function stubZen(options: StubOptions = {}) {
  const handlers: Array<(event: ExternalRunEvent) => void> = [];
  const off = vi.fn((handler: (event: ExternalRunEvent) => void) => {
    const index = handlers.indexOf(handler);
    if (index >= 0) {
      handlers.splice(index, 1);
    }
  });
  const send = vi.fn(options.send ?? (async () => ({ runId: "run-1" })));
  const sessions = options.sessions ?? [summary("claude:a")];
  (window as unknown as { zen: unknown }).zen = {
    externalSessions: {
      list: async () => ({
        sessions,
        groups: [
          { client: "claude", detected: true, count: 1 },
          { client: "gemini", detected: true, count: 1 },
        ],
        skipped: 0,
      }),
      trace:
        options.trace ??
        (async (id: string) => ({
          id,
          events: [{ kind: "user" as const, text: "历史消息" }],
          truncated: false,
        })),
      capabilities: async () => CAPABILITIES,
      send,
      stop: async () => ({ ok: true }),
      onRun: (handler: (event: ExternalRunEvent) => void) => {
        handlers.push(handler);
        return () => off(handler);
      },
    },
  };
  function emit(event: ExternalRunEvent) {
    for (const handler of [...handlers]) {
      handler(event);
    }
  }
  return { send, emit, off };
}

function mountPanel() {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(ExternalSessionsPanel, { global: { plugins: [pinia, i18n] } });
}

async function openSession(wrapper: ReturnType<typeof mountPanel>, sessionId: string) {
  await wrapper.find(`[data-testid="external-session-${sessionId}"]`).trigger("click");
  await flushPromises();
}

describe("ExternalSessionsPanel", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    localStorage.clear();
  });

  it("未安装 CLI 的客户端：提示原因并禁用输入框", async () => {
    stubZen({ sessions: [summary("gemini:g", "gemini")] });
    const wrapper = mountPanel();
    await flushPromises();
    await openSession(wrapper, "g");

    expect(wrapper.find('[data-testid="external-reason"]').text()).toContain("gemini");
    expect(wrapper.find('[data-testid="external-reason"]').text()).toContain("无法续聊");
    expect(wrapper.find('[data-testid="external-composer"]').attributes("disabled")).toBeDefined();
    expect(wrapper.find('[data-testid="external-capability"]').text()).toBe("未安装 CLI");

    wrapper.unmount();
  });

  it("发送后追加流式气泡，done 后换成权威记录", async () => {
    let calls = 0;
    const { send, emit } = stubZen({
      trace: async (id) => {
        calls += 1;
        return {
          id,
          events:
            calls === 1
              ? [{ kind: "user" as const, text: "历史消息" }]
              : [
                  { kind: "user" as const, text: "历史消息" },
                  { kind: "user" as const, text: "你好" },
                  { kind: "assistant" as const, text: "权威回复" },
                ],
          truncated: false,
        };
      },
    });
    const wrapper = mountPanel();
    await flushPromises();
    await openSession(wrapper, "a");

    expect(wrapper.find('[data-testid="external-capability"]').text()).toBe("可续聊");
    await wrapper.find('[data-testid="external-composer"]').setValue("你好");
    await wrapper.find('[data-testid="external-send"]').trigger("click");
    await flushPromises();

    expect(send).toHaveBeenCalledWith({ id: "claude:a", message: "你好" });
    expect(wrapper.find('[data-testid="external-local-run"]').exists()).toBe(true);

    emit({ id: "claude:a", runId: "run-1", type: "delta", text: "流式" });
    await flushPromises();
    expect(wrapper.find('[data-testid="external-record"]').text()).toContain("流式");

    emit({ id: "claude:a", runId: "run-1", type: "done" });
    await flushPromises();

    expect(wrapper.find('[data-testid="external-local-run"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="external-record"]').text()).toContain("权威回复");

    wrapper.unmount();
  });

  it("error 时错误气泡可见，原输入回到输入框", async () => {
    const { emit } = stubZen();
    const wrapper = mountPanel();
    await flushPromises();
    await openSession(wrapper, "a");

    await wrapper.find('[data-testid="external-composer"]').setValue("继续修");
    await wrapper.find('[data-testid="external-send"]').trigger("click");
    await flushPromises();
    expect((wrapper.find('[data-testid="external-composer"]').element as HTMLTextAreaElement).value).toBe("");

    emit({ id: "claude:a", runId: "run-1", type: "error", error: "CLI exited 1" });
    await flushPromises();

    expect(wrapper.find('[data-testid="external-record"]').text()).toContain("CLI exited 1");
    expect((wrapper.find('[data-testid="external-composer"]').element as HTMLTextAreaElement).value).toBe("继续修");

    wrapper.unmount();
  });

  it("卸载面板时退订进度事件", async () => {
    const { off } = stubZen();
    const wrapper = mountPanel();
    await flushPromises();

    wrapper.unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });
});
