import type { LocaleModule } from "../index";

/**
 * 模型自动路由文案（ModelPicker「自动」与路由理由展示）。
 * 键：modelRouting.*（命名空间即文件名 model-routing）。
 */
export default {
  "zh-CN": {
    modelRouting: {
      auto: "自动选择模型",
      autoSubtitle: "每次发送前，从已启用模型中按请求选择",
      autoHint: "参考文字、图片附件、工具需求和上下文估算；没有完全匹配的模型时可能回退到其他已启用模型。",
      autoBadge: "自动",
      autoAria: "自动选择模型：每次发送前从已启用模型中选择",
      rule: {
        "image-vision": "消息包含图片，优先支持视觉的模型",
        tools: "需要工具调用，优先启用工具的模型",
        "reasoning-task": "任务包含重构/调试/架构类特征，优先推理模型",
        "long-context": "上下文较长，优先大上下文模型",
        "casual-light": "简短问答，优先轻量快速模型",
        fallback: "未命中完全匹配的能力要求或任务特征，已按可用模型回退选择",
      },
      autoTitle: "自动选择模型（当前显示：{model}）\n{reason}",
      routedTo: "上次自动选择：{model}",
      reasonPrefix: "理由：",
      reasonSeparator: "；",
    },
  },
  "en-US": {
    modelRouting: {
      auto: "Auto-select model",
      autoSubtitle: "Choose from enabled models before each send",
      autoHint: "Considers text, image attachments, tool needs, and estimated context; may fall back to another enabled model if none fully matches.",
      autoBadge: "Auto",
      autoAria: "Auto-select model from enabled models before each send",
      rule: {
        "image-vision": "Message contains images; prefer a vision-capable model",
        tools: "Tool calls needed; prefer a model with tools enabled",
        "reasoning-task": "Task looks like refactor/debug/architecture work; prefer a reasoning model",
        "long-context": "Long context; prefer a model with a larger window",
        "casual-light": "Short question; prefer a lightweight fast model",
        fallback: "No exact capability or task match; fell back to an available model",
      },
      autoTitle: "Auto-select model (currently shown: {model})\n{reason}",
      routedTo: "Last auto pick: {model}",
      reasonPrefix: "Reason: ",
      reasonSeparator: "; ",
    },
  },
} satisfies LocaleModule;
