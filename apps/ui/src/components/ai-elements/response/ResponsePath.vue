<script setup lang="ts">
import { computed, inject, provide } from 'vue'
import type { MarkdownComponentProps } from 'vue-stream-markdown'
import { useSanitizers } from 'vue-stream-markdown'
import FileLabel from '@/components/files/FileLabel.vue'
import { resolveFileRefPath } from '@/components/files/file-ref'
import { classifyPathRef, localFilePathFromHref, normalizePathRef } from '@/lib/path-ref'
import { openAppLink } from '@/lib/open-link'
import { useSessionRoot } from '@/composables/useSessionRoot'
import { useRightPanelStore } from '@/stores/right-panel'

defineOptions({ inheritAttrs: false })
const props = defineProps<MarkdownComponentProps>()
const insideLink = inject('response-inside-link', false)
const isLink = computed(() => props.node[0] === 'a')
provide('response-inside-link', insideLink || isLink.value)
const raw = computed(() => isLink.value
  ? String(props.node[1].href ?? '')
  : props.node.slice(2).filter((child) => typeof child === 'string').join(''))
const path = computed(() => {
  if (isLink.value) return localFilePathFromHref(raw.value)
  return !insideLink && classifyPathRef(raw.value) ? normalizePathRef(raw.value) : null
})
const kind = computed(() => path.value && classifyPathRef(path.value) === 'dir' ? 'directory' : 'file')
const sessionRoot = useSessionRoot()
// 悬浮展示完整路径：相对引用按工作区根绝对化；无根时保持原文本（含行号锚点）
const fullPath = computed(() => (path.value && sessionRoot.value
  ? resolveFileRefPath(path.value, sessionRoot.value)
  : raw.value))
const { transformedUrl } = useSanitizers({ url: computed(() => isLink.value ? raw.value : undefined) })

function reveal(event: Event) {
  if (!path.value) return
  event.preventDefault()
  useRightPanelStore().revealFile(path.value)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') reveal(event)
}

function onLinkClick(event: Event) {
  const href = raw.value
  if (!href) return
  if (/^https?:\/\//i.test(href) || href.startsWith('//')) {
    event.preventDefault()
    void openAppLink(href)
  }
}
</script>

<template>
  <span
    v-if="path"
    :class="kind === 'directory' ? 'zen-dir-ref' : 'zen-file-ref'"
    :data-file-path="path"
    :title="fullPath"
    :aria-label="fullPath"
    role="link"
    tabindex="0"
    @click="reveal"
    @keydown="onKeydown"
  >
    <FileLabel :path="path" :kind="kind" variant="link" :root="sessionRoot" />
  </span>
  <a
    v-else-if="isLink"
    :href="transformedUrl ?? undefined"
    :title="String(props.node[1].title ?? '')"
    data-stream-markdown="link"
    @click="onLinkClick"
  ><slot /></a>
  <code v-else data-stream-markdown="code" dir="ltr"><slot /></code>
</template>
