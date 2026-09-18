<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import { computed, onUnmounted, useSlots } from 'vue'
import { useRightPanelStore } from '@/stores/right-panel'
import { Markdown } from 'vue-stream-markdown'
import { codeThemeId, compactCodeOptions, streamMarkdownExtensions } from '@/components/ai-elements/response/extensions'
import { classifyPathRef, normalizePathRef } from '@/lib/path-ref'
import 'vue-stream-markdown/index.css'

interface Props {
  content?: string
  /** 流式逐段淡入动画：新文本在动画前不可见（backwards 填充），快速输出时
   * 尾部长时间空白看不到实时内容，默认关闭保证内容随到随显 */
  enableAnimate?: boolean
  class?: HTMLAttributes['class']
}

const props = withDefaults(defineProps<Props>(), {
  enableAnimate: false,
})

const slots = useSlots()
const slotContent = computed<string | undefined>(() => {
  const nodes = slots.default?.()
  if (!Array.isArray(nodes)) {
    return undefined
  }
  let text = ''
  for (const node of nodes) {
    if (typeof node.children === 'string')
      text += node.children
  }
  return text || undefined
})

const md = computed(() => (slotContent.value ?? props.content ?? '') as string)

/* ---------- 正文内文件/目录引用 chip ----------
 * 行内代码若形如文件路径（含扩展名，可带 :行号 / #L行号）或目录路径（以 / 结尾，
 * 或多段无扩展名），补上 zen-file-ref / zen-dir-ref 类，图标与底色由 CSS 呈现。
 * 渲染器异步增量输出，用 MutationObserver 兜住每一批新节点；
 * 主题切换 :key 重挂载时 ref 会重新绑定并整体补挂一次。 */

function decorateFileRefs(root: ParentNode) {
  for (const el of root.querySelectorAll('code')) {
    if (el.closest('pre')) {
      continue
    }
    const kind = classifyPathRef(el.textContent ?? '')
    if (kind) {
      el.classList.add(kind === 'file' ? 'zen-file-ref' : 'zen-dir-ref')
      el.setAttribute('role', 'link')
      el.setAttribute('tabindex', '0')
      el.setAttribute('aria-label', `打开文件${el.textContent?.trim() ?? ''}`)
    }
  }
}

function revealPath(event: Event) {
  const target = event.target instanceof Element ? event.target.closest('code.zen-file-ref, code.zen-dir-ref') : null
  if (!(target instanceof HTMLElement)) {
    return
  }
  const raw = target.textContent ?? ''
  const path = normalizePathRef(raw)
  if (path && classifyPathRef(raw)) {
    useRightPanelStore().revealFile(path)
  }
}

function onPathKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    revealPath(event)
  }
}

let observer: MutationObserver | undefined
let frame = 0
let rootElement: HTMLElement | undefined

function bindRoot(instance: unknown) {
  const el = instance && typeof instance === 'object' && '$el' in instance
    ? (instance as { $el: unknown }).$el
    : instance
  if (!(el instanceof HTMLElement)) {
    return
  }
  // 重新绑定前先卸掉旧根节点上的监听，避免 :key 重挂载后累积
  if (rootElement) {
    rootElement.removeEventListener('click', revealPath)
    rootElement.removeEventListener('keydown', onPathKeydown)
  }
  observer?.disconnect()
  rootElement = el
  observer = new MutationObserver(() => {
    if (frame) {
      return
    }
    frame = requestAnimationFrame(() => {
      frame = 0
      if (el.isConnected) {
        decorateFileRefs(el)
      }
    })
  })
  observer.observe(el, { childList: true, characterData: true, subtree: true })
  decorateFileRefs(el)
  el.addEventListener('click', revealPath)
  el.addEventListener('keydown', onPathKeydown)
}

onUnmounted(() => {
  observer?.disconnect()
  observer = undefined
  if (frame) {
    cancelAnimationFrame(frame)
    frame = 0
  }
  if (rootElement) {
    rootElement.removeEventListener('click', revealPath)
    rootElement.removeEventListener('keydown', onPathKeydown)
    rootElement = undefined
  }
})
</script>

<template>
  <Markdown
    :key="codeThemeId"
    :content="md"
    :enable-animate="props.enableAnimate"
    :extensions="streamMarkdownExtensions"
    :code-options="compactCodeOptions"
    :is-dark="true"
    :class="
      cn(
        'w-full [&>*:first-child]:mt-0! [&>*:last-child]:mb-0!',
        props.class,
      )
    "
    :ref="bindRoot"
    v-bind="$attrs"
  />
</template>