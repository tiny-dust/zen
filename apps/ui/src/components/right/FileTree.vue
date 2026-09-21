<script setup lang="ts">
import { ChevronDown, ChevronRight } from "@lucide/vue";
import { onMounted, ref } from "vue";

import FileLabel from "@/components/files/FileLabel.vue";
import { Button } from "@/components/ui/button";

import type { DirEntry } from "@zen/shared";

const props = defineProps<{
  /** 工作区目录（绝对路径）；空表示未绑定目录 */
  root?: string;
  /** 相对工作区根的目录路径；根为空串 */
  rel?: string;
}>();

const emit = defineEmits<{
  select: [path: string];
}>();

const entries = ref<DirEntry[] | null>(null);
const expanded = ref(new Set<string>());

onMounted(async () => {
  const zen = window.zen;
  if (!zen || !props.root) {
    return;
  }
  entries.value = (await zen.workspace.readDir(props.root, props.rel ?? "")) ?? [];
});

function relPath(name: string) {
  return props.rel ? `${props.rel}/${name}` : name;
}

function toggle(entry: DirEntry) {
  const path = relPath(entry.name);
  if (!entry.isDir) {
    emit("select", path);
    return;
  }
  const next = new Set(expanded.value);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  expanded.value = next;
}

function depth() {
  return (props.rel?.split("/").length ?? 0) * 12 + 4;
}
</script>

<template>
  <div>
    <p
      v-if="entries === null"
      class="m-0 px-1 py-1.5 text-[12px] text-[var(--color-dim)]"
    >
      {{ root ? "读取中…" : "" }}
    </p>
    <template v-else>
      <p v-if="entries.length === 0" class="m-0 px-1 py-1 text-[12px] text-[var(--color-dim)]">
        空目录
      </p>
      <div v-for="entry in entries" :key="entry.name">
        <Button
          variant="ghost"
          class="flex h-[26px] w-full items-center justify-start gap-1 rounded-md pr-1.5 text-left font-normal text-[12px] md:text-[12px] text-[var(--color-side-item)] hover:bg-[var(--color-side-hover)] hover:text-[var(--color-txt)] dark:hover:bg-[var(--color-side-hover)]"
          :style="{ paddingLeft: `${depth()}px` }"
          @click="toggle(entry)"
        >
          <ChevronDown
            v-if="entry.isDir && expanded.has(relPath(entry.name))"
            class="size-3 flex-none text-[var(--color-dim)]"
          />
          <ChevronRight
            v-else-if="entry.isDir"
            class="size-3 flex-none text-[var(--color-dim)]"
          />
          <FileLabel
            :path="relPath(entry.name)"
            :kind="entry.isDir ? 'directory' : 'file'"
            :expanded="expanded.has(relPath(entry.name))"
            class="flex-1"
          />
        </Button>
        <FileTree
          v-if="entry.isDir && expanded.has(relPath(entry.name))"
          :root="props.root"
          :rel="relPath(entry.name)"
          @select="emit('select', $event)"
        />
      </div>
    </template>
  </div>
</template>
