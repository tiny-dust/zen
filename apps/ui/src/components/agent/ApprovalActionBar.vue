<script setup lang="ts">
import { IconCheck as Check, IconShieldCheck as ShieldCheck, IconX as X } from "@tabler/icons-vue";
import { useI18n } from "vue-i18n";

import { Button } from "@/components/ui/button";

/**
 * 高风险动作拦截条的动作组：允许一次 / 本次会话信任 / 拒绝。
 * 只负责展示与触发，审批范围与放行逻辑仍由调用方（chat store）决定。
 */
const emit = defineEmits<{
  approve: [];
  trust: [];
  deny: [];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5" role="group" :aria-label="t('chat.approval.title')">
    <Button size="sm" @click="emit('approve')">
      <Check data-icon="inline-start" />{{ t("chat.approval.approve") }}
    </Button>
    <Button
      variant="outline"
      size="sm"
      class="border-[color-mix(in_srgb,var(--agent-approval)_48%,var(--color-line))] text-[var(--agent-approval)]"
      @click="emit('trust')"
    >
      <ShieldCheck data-icon="inline-start" />{{ t("chat.approval.allowAllSession") }}
    </Button>
    <Button variant="outline" size="sm" @click="emit('deny')">
      <X data-icon="inline-start" />{{ t("chat.approval.deny") }}
    </Button>
    <span class="text-[11px] text-[var(--color-dim)]">{{ t("chat.approval.allowAllHint") }}</span>
  </div>
</template>
