import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Response from './Response.vue'
import { useRightPanelStore } from '@/stores/right-panel'

vi.mock('./extensions', () => ({
  codeThemeId: 'test', compactCodeOptions: {}, streamMarkdownExtensions: {},
}))

beforeEach(() => setActivePinia(createPinia()))

async function render(content: string) {
  const wrapper = mount(Response, { props: { content, class: 'md-content' } })
  await flushPromises()
  return wrapper
}

describe('Response file references', () => {
  it('renders inline paths and local Markdown links with FileLabel and the original path', async () => {
    const wrapper = await render('`src/App.vue:12` [label](src/main.ts) [file](file:///tmp/test.ts:20)')
    const refs = wrapper.findAll('[data-file-path]')
    expect(refs, wrapper.html()).toHaveLength(3)
    expect(refs.map((ref) => ref.text())).toEqual(['App.vue', 'main.ts', 'test.ts'])
    expect(refs[0].attributes('title')).toBe('src/App.vue:12')
    expect(wrapper.findAll('.file-label--link')).toHaveLength(3)
    await refs[0].trigger('click')
    expect(useRightPanelStore().pendingReveal).toBe('src/App.vue')
    await refs[1].trigger('keydown', { key: 'Enter' })
    expect(useRightPanelStore().pendingReveal).toBe('src/main.ts')
    await refs[2].trigger('keydown', { key: ' ' })
    expect(useRightPanelStore().pendingReveal).toBe('/tmp/test.ts')
    wrapper.unmount()
  })

  it('preserves external links, URL code, fenced code, and normal Space behavior', async () => {
    const wrapper = await render('[site](https://example.com/a.ts) [mail](mailto:a@b.com) [anchor](#title) [`src/App.vue`](https://example.com) `https://example.com/a.ts`\n\n```\nsrc/App.vue\n```\n\nordinary text')
    expect(wrapper.findAll('[data-file-path]')).toHaveLength(0)
    expect(wrapper.find('a').attributes('href')).toBe('https://example.com/a.ts')
    const event = new KeyboardEvent('keydown', { key: ' ', cancelable: true, bubbles: true })
    wrapper.element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    wrapper.unmount()
  })

  it('does not normalize file URLs used as images', async () => {
    const wrapper = await render('![image](file:///tmp/image.png)')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('[data-file-path]').exists()).toBe(false)
    wrapper.unmount()
  })

  it.each([
    ['file:///tmp/a%2520b.ts', '/tmp/a%20b.ts'],
    ['file:///tmp/a%25b.ts', '/tmp/a%b.ts'],
    ['file:///tmp/a%23b.ts', '/tmp/a#b.ts'],
    ['file:///tmp/a%3Fb.ts', '/tmp/a?b.ts'],
    ['file:///tmp/a.ts%23L12', '/tmp/a.ts#L12'],
    ['src/a.ts%23L12', 'src/a.ts#L12'],
    ['src/报告.ts', 'src/报告.ts'],
    ['src/hello%20world.ts', 'src/hello world.ts'],
    ['src/hello world.ts', 'src/hello world.ts'],
  ])('preserves the file target through the real parser: %s', async (href, path) => {
    const wrapper = await render(`[file](<${href}>)`)
    const ref = wrapper.get('[data-file-path]')
    expect(ref.attributes('data-file-path')).toBe(path)
    await ref.trigger('click')
    expect(useRightPanelStore().pendingReveal).toBe(path)
    wrapper.unmount()
  })

  it.each([
    'javascript:alert(1)', 'data:text/html,alert(1)', 'vbscript:alert(1)',
    'file://host/a.ts', 'file:///tmp/bad%00.ts', 'file:///tmp/bad%zz.ts',
  ])('rejects unsafe Markdown links and images: %s', async (href) => {
    const wrapper = await render(`[file](<${href}>) ![image](<${href}>)`)
    expect(wrapper.find('[data-file-path]').exists()).toBe(false)
    expect(wrapper.find('a[href]').exists()).toBe(false)
    expect(wrapper.find('img').exists()).toBe(false)
    wrapper.unmount()
  })

  it('updates labels and reveal targets when streamed content changes', async () => {
    const wrapper = await render('`src/App.vue`')
    await wrapper.setProps({ content: '`src/main.ts` [local](./README.md)' })
    await flushPromises()
    expect(wrapper.findAll('[data-file-path]').map((ref) => ref.text())).toEqual(['main.ts', 'README.md'])
    await wrapper.find('[data-file-path]').trigger('click')
    expect(useRightPanelStore().pendingReveal).toBe('src/main.ts')
    await wrapper.setProps({ content: '`not a file`' })
    await flushPromises()
    expect(wrapper.find('[data-file-path]').exists()).toBe(false)
    wrapper.unmount()
  })
})
