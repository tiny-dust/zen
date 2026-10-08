import { describe, expect, it } from "vitest";

import { MultiAgentOrchestrator, ResourceLock } from "./multi-agent";

/**
 * 多 Agent 调度回归：
 * - 空闲超时（无进展）取消；活跃保活；等待用户暂停空闲计时
 * - 无墙钟上限：持续有进展 / 等待用户不会因运行时长被杀
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
      { subAgentIdleTimeoutMs: 40 },
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
      { subAgentIdleTimeoutMs: 30 },
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
      { subAgentIdleTimeoutMs: 50 },
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
      { subAgentIdleTimeoutMs: 40 },
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
      { subAgentIdleTimeoutMs: 40 },
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

  it("长时间运行不被墙钟上限杀掉：持续进展 + 等待用户后仍能完成", async () => {
    let release: ((answer: string) => void) | undefined;
    const orchestrator = createOrchestrator(
      async (spec) => {
        // 先持续进展远超空闲阈值，再等待用户回答；无墙钟上限下都不应被取消
        for (let i = 0; i < 8; i += 1) {
          await new Promise((r) => setTimeout(r, 30));
          spec.onProgress();
        }
        spec.onWaitingUser(true);
        const answer = await new Promise<string>((resolve) => {
          release = resolve;
        });
        spec.onWaitingUser(false);
        return { ok: true, text: `long-run:${answer}` };
      },
      { subAgentIdleTimeoutMs: 40 },
    );

    const spawned = orchestrator.spawn({ name: "长跑任务", task: "跑很久但不空闲" });
    // 等到进入 waiting_user（此时已远超空闲阈值，但持续进展保活）
    await new Promise((r) => setTimeout(r, 280));
    expect(orchestrator.list()[0]?.status).toBe("waiting_user");
    expect(orchestrator.list()[0]?.error).toBeUndefined();

    release?.("done");
    const [node] = await orchestrator.waitForAgents([spawned.id]);
    expect(node?.status).toBe("done");
    expect(node?.result).toContain("long-run:done");
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
      },
    );

    orchestrator.spawn({ name: "first", task: "1" });
    orchestrator.spawn({ name: "second", task: "2" });
    await new Promise((r) => setTimeout(r, 30));
    expect(started).toEqual(["first"]);
    expect(orchestrator.list().find((n) => n.name === "second")?.status).toBe("queued");
  });
});

describe("MultiAgentOrchestrator 依赖 / 重试 / 取消 / 工具", () => {
  it("依赖满足后入队执行；依赖失败则自身失败；未知依赖被忽略", async () => {
    const orchestrator = createOrchestrator(async (spec) =>
      spec.task === "会失败"
        ? { ok: false, text: "", error: "故意失败" }
        : { ok: true, text: "ok" },
    );

    const base = orchestrator.spawn({ name: "base", task: "基础任务" });
    const child = orchestrator.spawn({ name: "child", task: "依赖任务", dependsOn: [base.id, "ghost-id"] });
    expect(child.status).toBe("waiting_deps");
    // 不存在的依赖 id 直接被过滤，不会卡死
    expect(child.dependsOn).toEqual([base.id]);

    const nodes = await orchestrator.waitForAgents([base.id, child.id]);
    expect(nodes.map((n) => n.status)).toEqual(["done", "done"]);
    expect(nodes[1]?.log.some((line) => line.text.includes("依赖已满足"))).toBe(true);

    const failing = orchestrator.spawn({
      name: "failing",
      task: "会失败",
      maxAttempts: 1,
    });
    await orchestrator.waitForAgents([failing.id]);
    const after = orchestrator.spawn({ name: "after", task: "依赖失败任务", dependsOn: [failing.id] });
    const [failedChild] = await orchestrator.waitForAgents([after.id]);
    expect(failedChild?.status).toBe("error");
    expect(failedChild?.error).toContain("依赖的子任务失败");
  });

  it("失败按 maxAttempts 重试，耗尽后标记 error；runChild 抛异常同样收尾", async () => {
    let attempts = 0;
    const orchestrator = createOrchestrator(async () => {
      attempts += 1;
      return { ok: false, text: "", error: "子任务炸了" };
    });
    const spawned = orchestrator.spawn({ name: "retry", task: "x", maxAttempts: 2 });
    const [node] = await orchestrator.waitForAgents([spawned.id]);
    expect(attempts).toBe(2);
    expect(node?.status).toBe("error");
    expect(node?.error).toBe("子任务炸了");
    expect(node?.log.some((line) => line.text.includes("将重试"))).toBe(true);

    const throwing = createOrchestrator(async () => {
      throw new Error("runChild 崩了");
    });
    const crashed = throwing.spawn({ name: "crash", task: "x" });
    const [crashedNode] = await throwing.waitForAgents([crashed.id]);
    expect(crashedNode?.status).toBe("error");
    expect(crashedNode?.error).toBe("runChild 崩了");
  });

  it("父会话 signal 中止会级联取消子任务", async () => {
    const parent = new AbortController();
    const orchestrator = createOrchestrator(
      (spec) =>
        new Promise((_, reject) => {
          spec.signal.addEventListener("abort", () => reject(new Error("已取消")), { once: true });
        }),
      { getParentSignal: () => parent.signal },
    );

    const spawned = orchestrator.spawn({ name: "cancellable", task: "x", maxAttempts: 3 });
    await new Promise((r) => setTimeout(r, 10));
    parent.abort();
    const [node] = await orchestrator.waitForAgents([spawned.id]);
    expect(node?.status).toBe("cancelled");
    expect(node?.reason).toBe("cancelled");
  });

  it("onTranscript/onLog 写入节点并裁剪超长日志", async () => {
    const orchestrator = createOrchestrator(async (spec) => {
      for (let i = 0; i < 50; i += 1) {
        spec.onLog(`log-${i}`);
      }
      spec.onTranscript?.([{ kind: "text", text: "记录" }] as never);
      return { ok: true, text: "done" };
    });

    const spawned = orchestrator.spawn({ name: "logs", task: "x" });
    const [node] = await orchestrator.waitForAgents([spawned.id]);
    expect(node?.log.length).toBe(40);
    expect(node?.transcript).toEqual([{ kind: "text", text: "记录" }]);
    const snapshot = orchestrator.snapshot();
    expect(snapshot.agents[0]?.transcript).toEqual([{ kind: "text", text: "记录" }]);
  });

  it("busyResource 随资源锁占用变化", async () => {
    const lock = new ResourceLock();
    const orchestrator = createOrchestrator(
      async (spec) =>
        lock.run(spec.agentId, "write", async () => {
          await new Promise((r) => setTimeout(r, 40));
          return { ok: true, text: "written" };
        }),
      { resourceLock: lock },
    );

    const spawned = orchestrator.spawn({ name: "writer", task: "x" });
    await new Promise((r) => setTimeout(r, 15));
    expect(orchestrator.list()[0]?.busyResource).toBe("write");
    const [node] = await orchestrator.waitForAgents([spawned.id]);
    expect(node?.status).toBe("done");
    expect(orchestrator.list()[0]?.busyResource).toBeNull();
  });

  it("cancelAll 取消进行中任务；dispose 后不再调度新任务", async () => {
    const orchestrator = createOrchestrator(
      (spec) =>
        new Promise((_, reject) => {
          spec.signal.addEventListener("abort", () => reject(new Error("取消")), { once: true });
        }),
      { subAgentIdleTimeoutMs: 10_000 },
    );

    const running = orchestrator.spawn({ name: "r", task: "x", maxAttempts: 3 });
    await new Promise((r) => setTimeout(r, 10));
    await orchestrator.cancelAll();
    const [cancelled] = await orchestrator.waitForAgents([running.id]);
    expect(cancelled?.status).toBe("cancelled");
    expect(cancelled?.error).toBe("主会话已取消");

    orchestrator.dispose();
    const late = orchestrator.spawn({ name: "late", task: "x" });
    await new Promise((r) => setTimeout(r, 20));
    expect(orchestrator.list().find((n) => n.id === late.id)?.status).toBe("queued");
  });

  it("buildTools：spawnAgent / listAgents / waitForAgents / collectAgentResults", async () => {
    const orchestrator = createOrchestrator(async () => ({ ok: true, text: "结果文本" }));
    const tools = orchestrator.buildTools();
    const options = { toolCallId: "tc", messages: [] } as never;

    const spawned = (await tools.spawnAgent!.execute!(
      { name: "t1", task: "任务一", maxAttempts: 2 },
      options,
    )) as { id: string; status: string };
    // spawn 返回快照时 runOne 可能已把状态推进到 running
    expect(["queued", "running"]).toContain(spawned.status);

    const listed = (await tools.listAgents!.execute!({}, options)) as Array<{
      id: string;
      hasResult: boolean;
    }>;
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(spawned.id);
    expect(typeof listed[0]?.hasResult).toBe("boolean");

    const waited = (await tools.waitForAgents!.execute!({ ids: [spawned.id] }, options)) as Array<{
      status: string;
      result: string;
    }>;
    expect(waited[0]?.status).toBe("done");
    expect(waited[0]?.result).toContain("结果文本");

    const collected = (await tools.collectAgentResults!.execute!(
      { ids: [spawned.id] },
      options,
    )) as Array<{ result: string; task: string }>;
    expect(collected[0]?.task).toBe("任务一");
    expect(collected[0]?.result).toContain("结果文本");

    const all = (await tools.collectAgentResults!.execute!({}, options)) as unknown[];
    expect(all).toHaveLength(1);
    const none = (await tools.waitForAgents!.execute!({}, options)) as unknown[];
    expect(none).toHaveLength(1);
  });
});

describe("MultiAgentOrchestrator 手动重试与结果保留", () => {
  it("失败的子任务手动重试后重新排队执行，尝试次数重置", async () => {
    let calls = 0;
    const orchestrator = createOrchestrator(async () => {
      calls += 1;
      if (calls === 1) {
        return { ok: false, text: "", error: "第一次失败" };
      }
      return { ok: true, text: "重试成功" };
    });

    const spawned = orchestrator.spawn({ name: "易失败任务", task: "跑一次", maxAttempts: 1 });
    const [failed] = await orchestrator.waitForAgents([spawned.id]);
    expect(failed?.status).toBe("error");
    expect(failed?.attempts).toBe(1);

    expect(orchestrator.retry(spawned.id)).toBe(true);
    const [retried] = await orchestrator.waitForAgents([spawned.id]);
    expect(retried?.status).toBe("done");
    expect(retried?.result).toBe("重试成功");
    // 重试预算重新计算（重新从第 1 次开始）
    expect(retried?.attempts).toBe(1);
    expect(retried?.error).toBeUndefined();
    expect(retried?.log.some((line) => line.text.includes("手动重试"))).toBe(true);
    expect(calls).toBe(2);
  });

  it("已取消的子任务可手动重试", async () => {
    let calls = 0;
    const orchestrator = createOrchestrator(
      (spec) =>
        new Promise((resolve) => {
          calls += 1;
          if (calls > 1) {
            resolve({ ok: true, text: "恢复执行" });
            return;
          }
          spec.signal.addEventListener(
            "abort",
            () => resolve({ ok: false, text: "", error: "cancelled" }),
            { once: true },
          );
        }),
    );

    const spawned = orchestrator.spawn({ name: "可取消任务", task: "x", maxAttempts: 1 });
    await new Promise((r) => setTimeout(r, 10));
    orchestrator.cancelAll();
    const [cancelled] = await orchestrator.waitForAgents([spawned.id]);
    expect(cancelled?.status).toBe("cancelled");

    expect(orchestrator.retry(spawned.id)).toBe(true);
    const [retried] = await orchestrator.waitForAgents([spawned.id]);
    expect(retried?.status).toBe("done");
    expect(retried?.result).toBe("恢复执行");
  });

  it("完成/进行中的子任务与不存在的 id 拒绝重试", async () => {
    const orchestrator = createOrchestrator(async () => ({ ok: true, text: "ok" }));
    const spawned = orchestrator.spawn({ name: "成功任务", task: "x" });
    await orchestrator.waitForAgents([spawned.id]);
    expect(orchestrator.retry(spawned.id)).toBe(false);
    expect(orchestrator.retry("missing-id")).toBe(false);
  });

  it("依赖的子任务仍失败时拒绝重试（先重试依赖）", async () => {
    const orchestrator = createOrchestrator(async () => ({
      ok: false,
      text: "",
      error: "依赖源失败",
    }));
    const first = orchestrator.spawn({ name: "A", task: "a", maxAttempts: 1 });
    const second = orchestrator.spawn({
      name: "B",
      task: "b",
      dependsOn: [first.id],
      maxAttempts: 1,
    });
    await orchestrator.waitForAgents([first.id, second.id]);
    expect(orchestrator.list().find((item) => item.id === second.id)?.error).toBe(
      "依赖的子任务失败，未执行",
    );
    expect(orchestrator.retry(second.id)).toBe(false);
    expect(orchestrator.retry(first.id)).toBe(true);
  });

  it("终态结果完整保留，不再截断到 2000 字符", async () => {
    const long = "报告内容 ".repeat(1_000); // 约 5K 字符
    const orchestrator = createOrchestrator(async () => ({ ok: true, text: long }));
    const spawned = orchestrator.spawn({ name: "长报告", task: "x" });
    const [node] = await orchestrator.waitForAgents([spawned.id]);
    expect(node?.result).toBe(long);
  });
});
