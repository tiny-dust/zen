import type { InjectionKey, Ref } from 'vue'
import { inject, provide } from 'vue'

export interface CommandContext {
  /** 输入框过滤词，由 CommandInput 写入 */
  search: Ref<string>
  /** 当前未被过滤掉的条目数，CommandEmpty 据此显隐 */
  visibleCount: Ref<number>
}

const COMMAND_KEY: InjectionKey<CommandContext> = Symbol('zen-command')

export function provideCommand(context: CommandContext): void {
  provide(COMMAND_KEY, context)
}

export function injectCommand(): CommandContext {
  const context = inject(COMMAND_KEY, null)
  if (!context) {
    throw new Error('Command* 子组件必须放在 <Command> 内使用')
  }
  return context
}
