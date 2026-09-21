import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Input } from './Input.vue'

export const inputVariants = cva(
  'rounded-lg bg-transparent py-1 text-base transition-colors md:text-sm w-full min-w-0 outline-none placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        // 表单输入：边框 + 聚焦线（聚焦反馈只做颜色变化，见 UI_STYLE.md 第 3 节第 7 条）
        default:
          'border-border focus-visible:border-ring aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 h-8 border px-2.5',
        // 无边框透明输入：高度与内距交给使用方 class 控制（浮层搜索、行内编辑等）
        ghost: 'border-0',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type InputVariants = VariantProps<typeof inputVariants>
