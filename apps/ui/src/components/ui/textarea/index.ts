import type { VariantProps } from 'class-variance-authority'
import { cva } from 'class-variance-authority'

export { default as Textarea } from './Textarea.vue'

export const textareaVariants = cva(
  'rounded-lg bg-transparent text-base transition-colors md:text-sm flex field-sizing-content w-full outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'border-border focus-visible:border-ring aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 min-h-16 border px-2.5 py-2',
        // 无边框透明：内嵌面板、行内编辑等场景，尺寸交给使用方 class
        ghost: 'border-0',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

export type TextareaVariants = VariantProps<typeof textareaVariants>
