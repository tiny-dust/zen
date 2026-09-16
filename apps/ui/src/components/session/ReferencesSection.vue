<script setup lang="ts">
import { ChevronDown, ExternalLink } from "@lucide/vue";
import { computed, ref } from "vue";

import { useSessionInfoStore } from "@/stores/session-info";

const sessionInfo = useSessionInfoStore();
const open = ref(true);
const refs = computed(() => sessionInfo.references);

const headCls =
  "flex min-h-8 w-full items-center gap-1.5 rounded-[var(--radius-sm)] text-left text-[13px] font-semibold text-[var(--color-txt-strong)] hover:text-[var(--color-txt)]";
</script>

<template>
  <section class="flex flex-col">
    <button type="button" :class="headCls" @click="open = !open">
      参考
      <ChevronDown
        class="size-3.5 text-[var(--color-dim)] transition-transform duration-[var(--motion-fast)]"
        :class="open ? '' : '-rotate-90'"
        aria-hidden="true"
      />
      <span
        v-if="refs.length"
        class="ml-auto inline-flex h-5 items-center rounded-full bg-[var(--color-chip-bg)] px-1.5 text-[10.5px] font-normal text-[var(--color-mut)]"
      >
        {{ refs.length }}
      </span>
    </button>
    <ul v-if="open" class="m-0 flex list-none flex-col gap-1 p-0 pb-1">
      <li v-if="!refs.length" class="text-[12px] text-[var(--color-dim)]">暂无参考</li>
      <li v-for="item in refs" :key="item.id" class="flex items-start gap-1.5">
        <a
          :href="item.url"
          target="_blank"
          rel="noreferrer"
          class="min-w-0 flex-1 truncate font-[family-name:var(--font-mono)] text-[11px] text-[var(--color-mut)] hover:text-[var(--color-txt)]"
          :title="item.url"
          @click.stop
        >
          {{ item.title || item.url }}
        </a>
        <ExternalLink class="mt-0.5 size-3 flex-none text-[var(--color-dim)]" aria-hidden="true" />
      </li>
    </ul>
  </section>
</template>
