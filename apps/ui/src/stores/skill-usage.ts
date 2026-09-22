import { defineStore } from "pinia";
import { ref } from "vue";

import { useAgentStore } from "@/stores/agent";

/**
 * 会话技能/MCP 调用感知：按会话记录本会话用到的技能与 MCP 服务，
 * 驱动输入框上方的动效 tag（SkillUsageTags）。数据来自流事件（loadSkill / mcp.*）
 * 与用户随消息携带的 /skill: token；仅存在于内存，会话切换互不影响。
 * 同名技能/MCP 合并为一条 tag（与 listSkills 同名去重一致）；再次调用触发 10s 呼吸高亮。
 */

export interface SkillUsageItem {
  /** 稳定键：skill:<展示名> / mcp:<server 名>（同名合并后唯一） */
  key: string;
  kind: "skill" | "mcp";
  /** 展示名：技能名或 MCP server 名 */
  name: string;
  /** 本会话累计调用次数 */
  calls: number;
  /** 最近一次调用是否仍在执行（驱动 tag 的进行中动效） */
  running: boolean;
  lastUsedAt: number;
  /** 再次调用呼吸高亮截止时间戳；0 表示不高亮 */
  breathUntil: number;
  /** 递增序号：再次调用时切换 class，重启 CSS animation */
  breathSeq: number;
}

/** 每会话最多保留的 tag 数：防长会话把输入框上方挤爆 */
const MAX_ENTRIES_PER_SESSION = 16;

/** 再次调用呼吸高亮时长 */
const BREATH_MS = 10_000;

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
    const name = skillDisplayName(skillId);
    return { key: `skill:${name}`, kind: "skill", name };
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
  const known = useAgentStore().skills.find(
    (item) => item.id === skillId || item.name === skillId,
  );
  if (known) {
    return known.name;
  }
  return skillId.split(/[\\/]/).filter(Boolean).pop() ?? skillId;
}

const breathTimers = new Map<string, ReturnType<typeof setTimeout>>();

export const useSkillUsageStore = defineStore("skill-usage", () => {
  const bySession = ref<Record<string, SkillUsageItem[]>>({});

  function entriesOf(sessionId: string): SkillUsageItem[] {
    return bySession.value[sessionId] ?? [];
  }

  function startBreath(item: SkillUsageItem): void {
    item.breathUntil = Date.now() + BREATH_MS;
    item.breathSeq += 1;
    const existingTimer = breathTimers.get(item.key);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    breathTimers.set(
      item.key,
      setTimeout(() => {
        item.breathUntil = 0;
        breathTimers.delete(item.key);
      }, BREATH_MS),
    );
  }

  function upsert(sessionId: string, target: { key: string; kind: "skill" | "mcp"; name: string }) {
    const list = bySession.value[sessionId] ?? [];
    const name =
      target.kind === "skill" ? skillDisplayName(target.name) : target.name;
    const key = `${target.kind}:${name}`;
    // 同名合并：不同 id 但展示名相同的技能只保留一条
    const existing = list.find(
      (item) => item.key === key || (item.kind === target.kind && item.name === name),
    );
    if (existing) {
      // 再次调用（N→N+1 且 N>=1）触发 10s 呼吸高亮；首次调用只走上浮动效
      if (existing.calls >= 1) {
        startBreath(existing);
      }
      existing.calls += 1;
      existing.running = true;
      existing.lastUsedAt = Date.now();
      existing.name = name;
      return existing;
    }
    const created: SkillUsageItem = {
      key,
      kind: target.kind,
      name,
      calls: 1,
      running: true,
      lastUsedAt: Date.now(),
      breathUntil: 0,
      breathSeq: 0,
    };
    // 超量时挤掉最旧的一条，保持 tag 行紧凑
    while (list.length >= MAX_ENTRIES_PER_SESSION) {
      const oldest = list.reduce((acc, item) =>
        item.lastUsedAt < acc.lastUsedAt ? item : acc,
      );
      list.splice(list.indexOf(oldest), 1);
      const timer = breathTimers.get(oldest.key);
      if (timer) {
        clearTimeout(timer);
        breathTimers.delete(oldest.key);
      }
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
    const name =
      target.kind === "skill" ? skillDisplayName(target.name) : target.name;
    const item = entriesOf(sessionId).find(
      (entry) =>
        entry.key === target.key ||
        (entry.kind === target.kind && entry.name === name),
    );
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
      // 用户给的是技能名：与 loadSkill 记录合并为同一条（按展示名合并）
      const created = upsert(sessionId, {
        key: `skill:${name}`,
        kind: "skill",
        name,
      });
      created.running = false;
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
