import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./extensions', () => ({
  codeThemeId: 'test',
  compactCodeOptions: {},
  streamMarkdownExtensions: {},
}))

vi.mock('vue-stream-markdown', () => ({
  Markdown: {
    name: 'Markdown',
    props: { content: { type: String, default: '' }, mode: { type: String, default: '' } },
    template: '<div class="md-stub" :data-mode="mode" />',
  },
}))

import Response from './Response.vue'

beforeEach(() => setActivePinia(createPinia()))

/**
 * 渲染器默认 mode=streaming，会把最后一个块节点当作「未闭合」并在表格/代码块
 * 下方渲染加载转圈；回复结束后必须传 static，否则末尾是表格的消息会永久留一个转圈。
 */
describe('Response markdown mode', () => {
  it('默认 static：已结束的消息不会再出现末尾加载态', () => {
    const wrapper = mount(Response, { props: { content: '| 方案 | 说明 |\n|---|---|\n| a | b |' } })
    expect(wrapper.get('.md-stub').attributes('data-mode')).toBe('static')
    wrapper.unmount()
  })

  it('streaming=true 时交给渲染器保持流式态', () => {
    const wrapper = mount(Response, { props: { content: '`src/App.vue`', streaming: true } })
    expect(wrapper.get('.md-stub').attributes('data-mode')).toBe('streaming')
    wrapper.unmount()
  })
})
