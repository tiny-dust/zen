import { describe, expect, it } from 'vitest'

import { matchesSearch } from './filter'

describe('matchesSearch', () => {
  it('空查询恒命中', () => {
    expect(matchesSearch('Resizable', undefined, '')).toBe(true)
    expect(matchesSearch('Resizable', undefined, '   ')).toBe(true)
  })

  it('子序列匹配（跨字符、不要求连续）', () => {
    expect(matchesSearch('Resizable', undefined, 'rsz')).toBe(true)
    expect(matchesSearch('FileBrowser', undefined, 'fb')).toBe(true)
  })

  it('顺序不符或字符缺失时不命中', () => {
    expect(matchesSearch('Resizable', undefined, 'zsr')).toBe(false)
    expect(matchesSearch('Resizable', undefined, 'xy')).toBe(false)
  })

  it('多词需全部命中，可分别落在关键词上', () => {
    expect(matchesSearch('Resizable', ['面板', '布局'], 'rsz 面板')).toBe(true)
    expect(matchesSearch('Resizable', ['面板'], 'rsz 主题')).toBe(false)
  })
})
