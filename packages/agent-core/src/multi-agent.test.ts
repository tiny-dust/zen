import { describe, expect, it } from "vitest";

import { MultiAgentOrchestrator, ResourceLock } from "./multi-agent";

/**
 * 多 Agent 调度回归：
 * - 空闲超时（无进展）取消；活跃保活；等待用户暂停空闲计时
 * - 绝对上限防真挂死
 * - 多问询并发：多个子任务同时 ask，分别回答后都能完成
 */

function createOrchestrator(
  runChild: ConstructorParameters<typeof MultiAgentOrchestrator>[0]["runChild"],
  overrides: Partial<ConstructorParameters<typeof MultiAgentOrchestrator>[0]> = {},
) {
  return new MultiAgentOrchestrator({
    parentSessionId: "sess-test",
    emit: () => {},
    resourceLock: new ResourceLock(),
    runChild,
    ...overrides,
  });
}

describe("MultiAgentOrchestrator 空闲超时与保活", () => {
  it("无进展时按空闲超时取消，重试耗尽后标记失败", async () => {
    let calls = 0;
    const orchestrator = createOrchestrator(
      () => {
        calls += 1;
        // 模拟挂死：永不返回、无任何进展
        return new Promise(() => {});
      },
      { subAgentIdleTimeoutMs: 40, subAgentMaxDurationMs: 10_000 },
    );

    const spawned = orchestrator.spawn({
      name: "慢任务",
      task: "永远跑不完的任务",
      maxAttempts: 2,
    });

    const [node] = await orchestrator.waitForAgents([spawned.id]);
    expect(calls).toBe(2);
    expect(node?.status).toBe("error");
    expect(node?.error).toContain("超时");
    expect(node?.error).toContain("空闲");
    expect(node?.log.some((line) => line.text.includes("将重试"))).toBe(true);
  });

  it("空闲超时中断会触发子会话取消信号", async () => {
    const signals: AbortSignal[] = [];
    const orchestrator = createOrchestrator(
      (spec) => {
        signals.push(spec.signal);
        return new Promise(() => {});
      },
      { subAgentIdleTimeoutMs: 30, subAgentMaxDurationMs: 10_000 },
    );

    const spawned = orchestrator.spawn({ name: "挂死任务", task: "x" });
    await orchestrator.waitForAgents([spawned.id]);

    expect(signals.length).toBeGreaterThanOrEqual(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("持续 onProgress 保活，不被空闲超时误杀", async () => {
    let progress = 0;
    const orchestrator = createOrchestrator(
      async (spec) => {
        // 每 15ms 一次进展，总时长 ~180ms；空闲阈值 50ms
        for (let i = 0; i < 12; i += 1) {
          await new Promise((r) => setTimeout(r, 15));
          progress += 1;
          spec.onProgress();
        }
        return { ok: true, text: `done-${progress}` };
      },
      { subAgentIdleTimeoutMs: 50, subAgentMaxDurationMs: 5_000 },
    );

    const spawned = orchestrator.spawn({ name: "活跃任务", task: "持续推进" });
    const [node] = await orchestrator.waitForAgents([spawned.id]);
    expect(node?.status).toBe("done");
    expect(progress).toBe(12);
  });

  it("工具执行中暂停空闲计时，长工具不被误杀", async () => {
    const orchestrator = createOrchestrator(
      async (spec) => {
        spec.onToolRunning(true);
        // 模拟长命令：远超空闲阈值
        await new Promise((r) => setTimeout(r, 160));
        spec.onToolRunning(false);
        return { ok: true, text: "tool-finished" };
      },
      { subAgentIdleTimeoutMs: 40, subAgentMaxDurationMs: 5_000 },
    );

    const spawned = orchestrator.spawn({ name: "长工具", task: "跑长命令" });
    const [node] = await orchestrator.waitForAgents([spawned.id]);
    expect(node?.status).toBe("done");
    expect(node?.result).toContain("tool-finished");
  });

  it("等待用户回答时状态为 waiting_user 且空闲计时暂停", async () => {
    let release: ((answer: string) => void) | undefined;
    const orchestrator = createOrchestrator(
      async (spec) => {
        spec.onWaitingUser(true);
        const answer = await new Promise<string>((resolve) => {
          release = resolve;
        });
        spec.onWaitingUser(false);
        return { ok: true, text: `answered:${answer}` };
      },
      { subAgentIdleTimeoutMs: 40, subAgentMaxDurationMs: 5_000 },
    );

    const spawned = orchestrator.spawn({ name: "问询任务", task: "问用户" });
    // 等到进入 waiting_user
    await new Promise((r) => setTimeout(r, 20));
    expect(orchestrator.list()[0]?.status).toBe("waiting_user");
    expect(orchestrator.list()[0]?.waitingUser).toBe(true);

    // 超过空闲阈值仍不应被杀
    await new Promise((r) => setTimeout(r, 80));
    expect(orchestrator.list()[0]?.status).toBe("waiting_user");

    expect(release).toBeTypeOf("function");
    release?.("yes");
    const [node] = await orchestrator.waitForAgents([spawned.id]);
    expect(node?.status).toBe("done");
    expect(node?.result).toContain("answered:yes");
    expect(node?.waitingUser).toBe(false);
  });

  it("绝对上限到点：即使等待用户也会取消", async () => {
    const orchestrator = createOrchestrator(
      async (spec) => {
        spec.onWaitingUser(true);
        await new Promise(() => {});
        return { ok: true, text: "never" };
      },
      { subAgentIdleTimeoutMs: 10_000, subAgentMaxDurationMs: 50 },
    );

    const spawned = orchestrator.spawn({ name: "久等任务", task: "用户不回答" });
    const [node] = await orchestrator.waitForAgents([spawned.id]);
    expect(node?.status).toBe("error");
    expect(node?.error).toContain("超时");
    expect(node?.error).toContain("最长执行时间");
  });
});

describe("MultiAgentOrchestrator 多问询并发", () => {
  it("两个子任务同时问询，分别回答后都能完成", async () => {
    type Resolver = (answer: string) => void;
    const resolvers = new Map<string, Resolver>();
    const asked: string[] = [];

    const orchestrator = createOrchestrator(
      async (spec) => {
        spec.onWaitingUser(true);
        asked.push(spec.agentId);
        const answer = await new Promise<string>((resolve) => {
          resolvers.set(spec.agentId, resolve);
        });
        spec.onWaitingUser(false);
        return { ok: true, text: `ok:${answer}` };
      },
      {
        concurrencyLimit: 2,
        subAgentIdleTimeoutMs: 10_000,
        subAgentMaxDurationMs: 5_000,
      },
    );

    const a = orchestrator.spawn({ name: "A", task: "问 A" });
    const b = orchestrator.spawn({ name: "B", task: "问 B" });

    // 等两个都进入 waiting_user
    for (let i = 0; i < 50; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
      if (resolvers.size >= 2) {
        break;
      }
    }
    expect(resolvers.size).toBe(2);
    const mid = orchestrator.list();
    expect(mid.every((n) => n.status === "waiting_user")).toBe(true);

    // 先答 A，B 仍等待
    resolvers.get(a.id)?.("answer-A");
    for (let i = 0; i < 30; i += 1) {
      await new Promise((r) => setTimeout(r, 10));
      const nodes = orchestrator.list();
      if (nodes.find((n) => n.id === a.id)?.status === "done") {
        break;
      }
    }
    expect(orchestrator.list().find((n) => n.id === a.id)?.status).toBe("done");
    expect(orchestrator.list().find((n) => n.id === b.id)?.status).toBe("waiting_user");

    // 再答 B
    resolvers.get(b.id)?.("answer-B");
    const nodes = await orchestrator.waitForAgents([a.id, b.id]);
    expect(nodes.map((n) => n.status)).toEqual(["done", "done"]);
    expect(nodes[0]?.result).toContain("answer-A");
    expect(nodes[1]?.result).toContain("answer-B");
  });

  it("并发槽包含 waiting_user：等待回答时不再启动新任务", async () => {
    const started: string[] = [];
    const orchestrator = createOrchestrator(
      async (spec) => {
        started.push(spec.name);
        spec.onWaitingUser(true);
        await new Promise(() => {});
        return { ok: true, text: "x" };
      },
      {
        concurrencyLimit: 1,
        subAgentIdleTimeoutMs: 10_000,
        subAgentMaxDurationMs: 5_000,
      },
    );

    orchestrator.spawn({ name: "first", task: "1" });
    orchestrator.spawn({ name: "second", task: "2" });
    await new Promise((r) => setTimeout(r, 30));
    expect(started).toEqual(["first"]);
    expect(orchestrator.list().find((n) => n.name === "second")?.status).toBe("queued");
  });
});
