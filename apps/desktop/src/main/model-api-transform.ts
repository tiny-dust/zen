/** 剥离 reasoning 模型内联在正文里的思考块：<think>…</think>，以及未闭合的前导 <think>… */
export function stripThinkBlocks(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^\s*<think>[\s\S]*$/i, "")
    .trim();
}

/** 从多种 chat/completions 响应形态里抽出最终文本（思考内容不算正文） */
export function extractChatText(data: unknown): string {
  const payload = data as {
    choices?: Array<{
      message?: {
        content?: unknown;
        reasoning_content?: string;
        reasoning?: string;
        text?: string;
      };
      text?: string;
    }>;
    output_text?: string;
  };

  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return stripThinkBlocks(payload.output_text);
  }

  const choice = payload?.choices?.[0];
  const message = choice?.message;
  if (!message) {
    return typeof choice?.text === "string" ? stripThinkBlocks(choice.text) : "";
  }

  // content 可能是 string，或 OpenAI 多模态数组 [{type:'text', text:'...'}]；内联 <think> 时剥离后为空则走兜底
  if (typeof message.content === "string") {
    const stripped = stripThinkBlocks(message.content);
    if (stripped) {
      return stripped;
    }
  }
  if (Array.isArray(message.content)) {
    const text = message.content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        const p = part as { type?: string; text?: string };
        return p?.type === "text" || typeof p?.text === "string" ? (p.text ?? "") : "";
      })
      .join("")
      .trim();
    if (text) {
      return text;
    }
  }
  if (typeof message.text === "string" && message.text.trim()) {
    return stripThinkBlocks(message.text);
  }

  // 部分 reasoning 模型 content 为空时，正文可能落在 reasoning_content
  const reasoning = message.reasoning_content || message.reasoning;
  if (typeof reasoning === "string") {
    const stripped = stripThinkBlocks(reasoning);
    if (stripped) {
      return stripped;
    }
  }
  return "";
}
