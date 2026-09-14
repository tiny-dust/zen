import type { AgentStreamEvent, ChatTurn, ProviderProtocol } from "@zen/shared";

export interface ChatRunOptions {
  protocol: ProviderProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  messages: ChatTurn[];
  signal: AbortSignal;
  emit: (event: AgentStreamEvent) => void;
}

function normalizeBase(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, "");
}

function openAiChatUrl(baseUrl: string): string {
  const base = normalizeBase(baseUrl);
  if (/\/v\d+$/.test(base)) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/chat/completions`;
}

function openAiResponsesUrl(baseUrl: string): string {
  const base = normalizeBase(baseUrl);
  if (/\/v\d+$/.test(base)) {
    return `${base}/responses`;
  }
  return `${base}/v1/responses`;
}

function anthropicMessagesUrl(baseUrl: string): string {
  const base = normalizeBase(baseUrl);
  if (/\/v\d+$/.test(base)) {
    return `${base}/messages`;
  }
  return `${base}/v1/messages`;
}

async function readSse(
  response: Response,
  signal: AbortSignal,
  onEvent: (data: string) => void,
): Promise<void> {
  const body = response.body;
  if (!body) {
    throw new Error("响应无流式正文");
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    if (signal.aborted) {
      await reader.cancel().catch(() => undefined);
      return;
    }
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const rawLine of parts) {
      const line = rawLine.trim();
      if (!line.startsWith("data:")) {
        continue;
      }
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") {
        continue;
      }
      onEvent(data);
    }
  }
}

async function runOpenAiChat(options: ChatRunOptions): Promise<void> {
  const response = await fetch(openAiChatUrl(options.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": "zen-desktop",
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      stream: true,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  await readSse(response, options.signal, (data) => {
    try {
      const payload = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string } }>;
      };
      const text = payload.choices?.[0]?.delta?.content;
      if (text) {
        options.emit({ type: "delta", text });
      }
    } catch {
      // ignore malformed chunk
    }
  });
}

async function runOpenAiResponses(options: ChatRunOptions): Promise<void> {
  const response = await fetch(openAiResponsesUrl(options.baseUrl), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": "zen-desktop",
    },
    body: JSON.stringify({
      model: options.model,
      input: options.messages,
      stream: true,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  await readSse(response, options.signal, (data) => {
    try {
      const payload = JSON.parse(data) as {
        type?: string;
        delta?: string;
        text?: string;
      };
      const text =
        payload.type === "response.output_text.delta"
          ? payload.delta
          : payload.type === "response.output_text.done"
            ? payload.text
            : undefined;
      if (text) {
        options.emit({ type: "delta", text });
      }
    } catch {
      // ignore
    }
  });
}

async function runAnthropicMessages(options: ChatRunOptions): Promise<void> {
  const system = options.messages
    .filter((item) => item.role === "system")
    .map((item) => item.content)
    .join("\n\n");
  const turns = options.messages.filter(
    (item) => item.role === "user" || item.role === "assistant",
  );

  const response = await fetch(anthropicMessagesUrl(options.baseUrl), {
    method: "POST",
    headers: {
      "x-api-key": options.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      "User-Agent": "zen-desktop",
    },
    body: JSON.stringify({
      model: options.model,
      max_tokens: 4096,
      stream: true,
      ...(system ? { system } : {}),
      messages: turns,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  await readSse(response, options.signal, (data) => {
    try {
      const payload = JSON.parse(data) as {
        type?: string;
        delta?: { text?: string };
      };
      if (payload.type === "content_block_delta" && payload.delta?.text) {
        options.emit({ type: "delta", text: payload.delta.text });
      }
    } catch {
      // ignore
    }
  });
}

export async function runChatAgent(options: ChatRunOptions): Promise<void> {
  if (options.signal.aborted) {
    options.emit({ type: "done", reason: "cancelled" });
    return;
  }

  try {
    if (options.protocol === "anthropic-messages") {
      await runAnthropicMessages(options);
    } else if (options.protocol === "openai-responses") {
      await runOpenAiResponses(options);
    } else {
      await runOpenAiChat(options);
    }

    options.emit({
      type: "done",
      reason: options.signal.aborted ? "cancelled" : "stop",
    });
  } catch (error) {
    if (options.signal.aborted || (error as Error)?.name === "AbortError") {
      options.emit({ type: "done", reason: "cancelled" });
      return;
    }
    const message = error instanceof Error ? error.message : "对话请求失败";
    options.emit({ type: "error", message });
    options.emit({ type: "done", reason: "error" });
  }
}
