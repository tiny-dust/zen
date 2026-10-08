import { describe, expect, it } from "vitest";

import { multiAgentInstructions, subAgentInstructions } from "./multi-agent-instructions";

/**
 * 多 Agent 约定文案：主会话注入协作约定，子 Agent 注入受限职责前缀。
 */

describe("multiAgent-instructions", () => {
  it("主会话约定覆盖 spawn/依赖/超时/多问询/临时文件", () => {
    const text = multiAgentInstructions();
    expect(text).toContain("【多 Agent 协作】");
    expect(text).toContain("spawnAgent");
    expect(text).toContain("dependsOn");
    expect(text).toContain("空闲）超时");
    expect(text).toContain("askUser");
    expect(text).toContain(".zen/cache");
  });

  it("子 Agent 前缀带名称与父会话 id，并禁止扩权", () => {
    const text = subAgentInstructions({ name: "helper", parentSessionId: "sess-p" });
    expect(text).toContain("子 Agent「helper」");
    expect(text).toContain("父会话 sess-p");
    expect(text).toContain("不要扩权");
    expect(text).toContain("不要 git commit");
  });
});
