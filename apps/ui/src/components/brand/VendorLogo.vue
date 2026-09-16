<script setup lang="ts">
import { computed } from "vue";

import { inferVendorKey, VENDOR_SVG } from "@/components/brand/vendor-icons";

const props = defineProps<{
  vendor?: string;
  size?: number;
}>();

const brand = computed(() => {
  const key =
    props.vendor && VENDOR_SVG[props.vendor] ? props.vendor : inferVendorKey(props.vendor);
  return VENDOR_SVG[key] ?? VENDOR_SVG.other!;
});

const size = computed(() => props.size ?? 18);
const pad = computed(() => Math.max(2, Math.round(size.value * 0.14)));
const rootStyle = computed(() => ({
  width: `${size.value}px`,
  height: `${size.value}px`,
  background: brand.value.bg,
}));
</script>

<template>
  <span
    class="inline-flex flex-none items-center justify-center overflow-hidden rounded-md text-white select-none"
    :style="rootStyle"
    :title="brand.title"
    aria-hidden="true"
  >
    <svg
      :width="size - pad * 2"
      :height="size - pad * 2"
      viewBox="0 0 24 24"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path :d="brand.path" />
    </svg>
  </span>
</template>
