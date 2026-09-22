import { defineStore } from "pinia";
import { ref } from "vue";

import { useAgentStore } from "@/stores/agent";

/**
 * 会话技能/MCP 调用感知：按会话记录本会话用到的技能与 MCP 服务，
 * 驱动输入框上方的动效 tag（SkillUsageTags）。数据来自流事件（loadSkill / mcp.*）
 * 与用户随消息携带的 /skill: token；仅存在于内存，会话切换互不影响。
 */

export interface SkillUsageItem {
  /** 稳定键：skill:<技能 id 或名> / mcp:<server 名> */
  key: string;
  kind: "skill" | "mcp";
  /** 展示名：技能名或 MCP server 名 */
  name: string;
  /** 本会话累计调用次数 */
  calls: number;
  /** 最近一次调用是否仍在执行（驱动 tag 的进行中动效） */
  running: boolean;
  lastUsedAt: number;
}

/** 每会话最多保留的 tag 数：防长会话把输入框上方挤爆 */
const MAX_ENTRIES_PER_SESSION = 16;

/** 从工具名/入参解析调用对象；非技能/MCP 工具返回 null */
export function usageTargetFromTool(
  toolName: string,
  args: unknown,
): { key: string; kind: "skill" | "mcp"; name: string } | null {
  if (toolName === "loadSkill") {
    const skillId =
      typeof args === "object" && args !== null && "skillId" in args
        ? String((args as { skillId: unknown }).skillId)
        : "";
    if (!skillId) {
      return null;
    }
    return { key: `skill:${skillId}`, kind: "skill", name: skillId };
  }
  if (toolName.startsWith("mcp.")) {
    // 工具名形如 mcp.<server>.<tool>；server 名含点时按已知桥接仍取第一段
    const server = toolName.slice("mcp.".length).split(".")[0] ?? "";
    if (!server) {
      return null;
    }
    return { key: `mcp:${server}`, kind: "mcp", name: server };
  }
  return null;
}

/** 技能 id（目录路径）→ 展示名：优先已知技能名，回落取路径尾段 */
function skillDisplayName(skillId: string): string {
  const known = useAgentStore().skills.find((item) => item.id === skillId);
  if (known) {
    return known.name;
  }
  return skillId.split(/[\\/]/).filter(Boolean).pop() ?? skillId;
}

export const useSkillUsageStore = defineStore("skill-usage", () => {
  const bySession = ref<Record<string, SkillUsageItem[]>>({});

  function entriesOf(sessionId: string): SkillUsageItem[] {
    return bySession.value[sessionId] ?? [];
  }

  function upsert(sessionId: string, target: { key: string; kind: "skill" | "mcp"; name: string }) {
    const list = bySession.value[sessionId] ?? [];
    const existing = list.find((item) => item.key === target.key);
    if (existing) {
      existing.calls += 1;
      existing.running = true;
      existing.lastUsedAt = Date.now();
      return existing;
    }
    const name =
      target.kind === "skill" ? skillDisplayName(target.name) : target.name;
    const created: SkillUsageItem = {
      key: target.key,
      kind: target.kind,
      name,
      calls: 1,
      running: true,
      lastUsedAt: Date.now(),
    };
    // 超量时挤掉最旧的一条，保持 tag 行紧凑
    while (list.length >= MAX_ENTRIES_PER_SESSION) {
      const oldest = list.reduce((acc, item) =>
        item.lastUsedAt < acc.lastUsedAt ? item : acc,
      );
      list.splice(list.indexOf(oldest), 1);
    }
    list.push(created);
    bySession.value[sessionId] = list;
    return created;
  }

  /** 流事件 tool_start：技能/MCP 工具开始执行 */
  function noteToolStart(sessionId: string, toolName: string, args: unknown): void {
    const target = usageTargetFromTool(toolName, args);
    if (target) {
      upsert(sessionId, target);
    }
  }

  /** 流事件 tool_end：按 toolName+args 定位同一条 tag，结束进行中动效 */
  function noteToolEnd(sessionId: string, toolName: string, ok: boolean, args: unknown): void {
    const target = usageTargetFromTool(toolName, args);
    if (!target) {
      return;
    }
    const item = entriesOf(sessionId).find((entry) => entry.key === target.key);
    if (item) {
      item.running = false;
      if (!ok) {
        // 失败不再累计次数以外的状态；tag 仅作感知用，错误细节在时间线工具卡里
        item.lastUsedAt = Date.now();
      }
    }
  }

  /** 用户随消息携带的技能（/skill: token，meta.skills）：发送即视为已调用 */
  function noteSkills(sessionId: string, names: string[]): void {
    for (const raw of names) {
      const name = String(raw ?? "").trim();
      if (!name) {
        continue;
      }
      // 用户给的是技能名：尽量对齐到已知技能的 id 键，与 loadSkill 记录合并为同一条
      const known = useAgentStore().skills.find((item) => item.name === name);
      upsert(sessionId, {
        key: `skill:${known?.id ?? name}`,
        kind: "skill",
        name: known?.id ?? name,
      });
      const item = entriesOf(sessionId).find(
        (entry) => entry.key === `skill:${known?.id ?? name}`,
      );
      if (item) {
        item.running = false;
      }
    }
  }

  /** run 结束：清掉所有「进行中」动效（取消/中断的调用也落定） */
  function endRun(sessionId: string): void {
    for (const item of entriesOf(sessionId)) {
      item.running = false;
    }
  }

  return { bySession, entriesOf, noteToolStart, noteToolEnd, noteSkills, endRun };
});
