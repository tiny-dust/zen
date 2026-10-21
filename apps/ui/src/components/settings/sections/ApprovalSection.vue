<script setup lang="ts">
import { ListChecks, ShieldCheck, Trash2, TriangleAlert } from "@lucide/vue";
import { storeToRefs } from "pinia";
import { ref } from "vue";
import { useI18n } from "vue-i18n";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAgentStore } from "@/stores/agent";

import type { CommandApprovalRule } from "@zen/shared";

/**
 * 命令规则与自动核准（写 agent 设置，下次会话生效）：
 * - 命令前缀规则表：命中 allow 前缀的执行类命令自动放行（审批卡不出现）；
 * - 帮我核准：审批请求先交当前生效模型安全审查，判定安全自动放行并标注理由。
 */
const { t } = useI18n();
const agentStore = useAgentStore();
const { settings } = storeToRefs(agentStore);

const newPattern = ref("");
const newDecision = ref<string>("allow");

/** 保存规则表：载荷重建为纯对象（IPC 过桥要求 structured-clone 可克隆，见 zen-005） */
function saveRules(rules: CommandApprovalRule[]) {
  void agentStore.updateSettings({
    approvalRules: rules.map((rule) => ({
      pattern: rule.pattern.trim(),
      decision: rule.decision,
    })),
  });
}

function addRule() {
  const pattern = newPattern.value.trim();
  if (!pattern) {
    return;
  }
  saveRules([
    ...settings.value.approvalRules,
    { pattern, decision: newDecision.value as CommandApprovalRule["decision"] },
  ]);
  newPattern.value = "";
}

function removeRule(index: number) {
  saveRules(settings.value.approvalRules.filter((_item, i) => i !== index));
}

function toggleReviewer(enabled: boolean) {
  void agentStore.updateSettings({ approvalReviewer: enabled ? "assistant" : "off" });
}
</script>

<template>
  <section id="set-agent-approval" class="flex flex-col gap-2.5 scroll-mt-2">
    <div class="flex items-center gap-2">
      <ListChecks :size="15" class="text-[var(--color-mut)]" />
      <h3 class="m-0 text-[13px] font-semibold text-[var(--color-txt-strong)]">
        {{ t("settings.agent.approvalTitle") }}
      </h3>
    </div>
    <p class="m-0 text-[12px] text-[var(--color-mut)]">
      {{ t("settings.agent.approvalDesc") }}
    </p>

    <!-- 命令前缀规则表 -->
    <div
      class="flex flex-col gap-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)] p-3"
    >
      <div class="text-[13px] font-semibold text-[var(--color-txt-strong)]">
        {{ t("settings.agent.approvalRulesTitle") }}
      </div>
      <p class="m-0 text-[11px] leading-snug text-[var(--color-mut)]">
        {{ t("settings.agent.approvalRulesHint") }}
      </p>
      <div v-if="settings.approvalRules.length" class="flex flex-col gap-1">
        <div
          v-for="(rule, index) in settings.approvalRules"
          :key="`${rule.pattern}-${index}`"
          class="flex min-h-8 items-center gap-2 rounded-lg px-2 transition-colors hover:bg-[var(--color-menu-hover)]"
        >
          <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--color-txt)]">
            {{ rule.pattern }}
          </span>
          <Badge variant="secondary" class="flex-none text-[10px]">
            {{
              rule.decision === "allow"
                ? t("settings.agent.approvalDecisionAllow")
                : t("settings.agent.approvalDecisionAsk")
            }}
          </Badge>
          <Button
            variant="ghost"
            size="icon-sm"
            class="flex-none text-[var(--color-mut)] hover:text-[var(--color-txt)]"
            :aria-label="t('settings.agent.approvalDeleteRuleAria', { pattern: rule.pattern })"
            @click="removeRule(index)"
          >
            <Trash2 :size="14" />
          </Button>
        </div>
      </div>
      <p v-else class="m-0 text-[11px] leading-snug text-[var(--color-mut)]">
        {{ t("settings.agent.approvalRuleEmpty") }}
      </p>
      <div class="flex items-center gap-2">
        <Input
          v-model="newPattern"
          class="h-8 min-w-0 flex-1 text-[12px]"
          :placeholder="t('settings.agent.approvalRulePatternPlaceholder')"
          @keydown.enter="addRule"
        />
        <Select v-model="newDecision">
          <SelectTrigger
            class="h-8 w-[112px] flex-none text-[12px]"
            :aria-label="t('settings.agent.approvalDecisionAria')"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="allow">{{ t("settings.agent.approvalDecisionAllow") }}</SelectItem>
            <SelectItem value="ask">{{ t("settings.agent.approvalDecisionAsk") }}</SelectItem>
          </SelectContent>
        </Select>
        <Button size="sm" class="h-8 flex-none" :disabled="!newPattern.trim()" @click="addRule">
          {{ t("settings.agent.approvalAddRule") }}
        </Button>
      </div>
    </div>

    <!-- 帮我核准 -->
    <div
      class="flex flex-col gap-2 rounded-xl border border-[var(--color-line-soft)] bg-[var(--color-np-btn-bg)] p-3"
    >
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-1.5">
          <ShieldCheck :size="14" class="flex-none text-[var(--color-mut)]" />
          <span class="text-[13px] font-semibold text-[var(--color-txt-strong)]">
            {{ t("settings.agent.approvalReviewerTitle") }}
          </span>
        </div>
        <Switch
          :model-value="settings.approvalReviewer === 'assistant'"
          :aria-label="t('settings.agent.approvalReviewerToggle')"
          @update:model-value="toggleReviewer"
        />
      </div>
      <p class="m-0 text-[11px] leading-snug text-[var(--color-mut)]">
        {{ t("settings.agent.approvalReviewerDesc") }}
      </p>
      <div
        v-if="settings.approvalReviewer === 'assistant'"
        class="flex items-start gap-2 rounded-lg bg-[color-mix(in_srgb,var(--color-warn,#d97709)_10%,transparent)] px-3 py-2 text-[11px] text-[var(--color-mut)]"
      >
        <TriangleAlert :size="14" class="mt-0.5 flex-none text-[var(--color-warn,#d97709)]" />
        {{ t("settings.agent.approvalReviewerWarning") }}
      </div>
    </div>
  </section>
</template>
