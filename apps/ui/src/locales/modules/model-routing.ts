import type { LocaleModule } from "../index";

/**
 * 模型自动路由文案（ModelPicker「自动」与路由理由展示）。
 * 键：modelRouting.*（命名空间即文件名 model-routing）。
 */
export default {
  "zh-CN": {
    modelRouting: {
      auto: "自动",
      autoSubtitle: "根据任务自动选择模型",
      autoBadge: "自动",
      autoAria: "选择自动模型路由",
      rule: {
        "image-vision": "消息包含图片，已选择支持视觉的模型",
        tools: "需要工具调用，已选择启用工具的模型",
        "reasoning-task": "任务包含重构/调试/架构类特征，优先推理模型",
        "long-context": "上下文较长，优先大上下文模型",
        "casual-light": "简短问答，优先轻量快速模型",
        fallback: "无完全匹配的模型，已按默认顺序选择",
      },
      autoTitle: "自动模式：{model}\n{reason}",
      routedTo: "上次自动选择：{model}",
      reasonPrefix: "理由",
    },
  },
  "en-US": {
    modelRouting: {
      auto: "Auto",
      autoSubtitle: "Pick a model based on the task",
      autoBadge: "Auto",
      autoAria: "Select automatic model routing",
      rule: {
        "image-vision": "Message contains images; selected a vision-capable model",
        tools: "Tool calls needed; selected a model with tools enabled",
        "reasoning-task": "Task looks like refactor/debug/architecture work; prefer a reasoning model",
        "long-context": "Long context; prefer a model with a larger window",
        "casual-light": "Short question; prefer a lightweight fast model",
        fallback: "No exact match; selected by default order",
      },
      autoTitle: "Auto mode: {model}\n{reason}",
      routedTo: "Last auto pick: {model}",
      reasonPrefix: "Reason",
    },
  },
} satisfies LocaleModule;
