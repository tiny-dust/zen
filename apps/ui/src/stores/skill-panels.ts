import { defineStore } from "pinia";
import { ref } from "vue";

import { useAgentStore } from "@/stores/agent";

import type { SkillPanelInfo } from "@zen/shared";

/** 被用户关掉的面板（跨会话记忆，按技能名） */
const HIDDEN_KEY = "zen.skillPanels.hidden";

function readHidden(): string[] {
  try {
    const raw = localStorage.getItem(HIDDEN_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/**
 * 技能面板（panel.json）缓存与显隐状态。
 * 对应 Claude Code 插件的持久状态（atom）：zen 只存显隐，指标由会话数据现算，
 * 面板 UI 由技能自带的 HTML 在沙箱 iframe 里渲染。
 */
export const useSkillPanelsStore = defineStore("skill-panels", () => {
  /** 技能目录 → 面板信息；null = 该技能没有 panel.json（缓存下来避免重复请求） */
  const byDir = ref<Record<string, SkillPanelInfo | null>>({});
  const hidden = ref<string[]>(readHidden());

  async function ensure(dir: string): Promise<SkillPanelInfo | null> {
    if (dir in byDir.value) {
      return byDir.value[dir];
    }
    const info = await useAgentStore()
      .skillPanel(dir)
      .catch(() => null);
    byDir.value[dir] = info ?? null;
    return byDir.value[dir];
  }

  function isHidden(skillName: string): boolean {
    return hidden.value.includes(skillName);
  }

  function setHidden(skillName: string, value: boolean): void {
    hidden.value = value
      ? [...new Set([...hidden.value, skillName])]
      : hidden.value.filter((item) => item !== skillName);
    try {
      localStorage.setItem(HIDDEN_KEY, JSON.stringify(hidden.value));
    } catch {
      // 写不进去（隐私模式等）只保留内存态
    }
  }

  return { byDir, hidden, ensure, isHidden, setHidden };
});
