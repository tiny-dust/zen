import type { AgentStreamEvent, AgentTranscriptEntry } from "@zen/shared";

/**
 * DESIGN — 子 Agent 消息流收集器
 *
 * 子会话的流事件（delta / 工具 / ask / 错误）此前被降级成单行 log（截断 240 字符、
 * 上限 40 行），面板只能看到碎片。收集器把同一批事件归约成结构化时间线：
 * - 连续 delta 合并进同一条 text 条目（reasoning 同理），不再是逐 chunk 碎片
 * - 工具按 toolCallId 归并生命周期（input-streaming → running → ok/error/…），
 *   保留工具名、入参、tool_end 摘要与输出尾部
 * - ask_user / ask_resolved 记为 ask 条目（提问与用户回答）
 * - 限量：条目数与单条正文均截断，避免长任务把 snapshot 撑爆
 */

const MAX_ENTRIES = 300;
const MAX_TEXT_CHARS = 20_000;
const MAX_OUTPUT_CHARS = 4_000;
const MAX_ARGS_JSON_CHARS = 800;

function truncateText(text: string, limit: number, marker = "…（已截断）"): string {
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit)}${marker}`;
}

function truncateArgs(args: unknown): unknown {
  if (args == null) {
    return undefined;
  }
  if (typeof args === "string") {
    return truncateText(args, MAX_ARGS_JSON_CHARS);
  }
  try {
    const json = JSON.stringify(args);
    if (json != null && json.length > MAX_ARGS_JSON_CHARS) {
      return { __truncated: truncateText(json, MAX_ARGS_JSON_CHARS) };
    }
    return args;
  } catch {
    return String(args);
  }
}

export class SubAgentTranscript {
  private readonly entries: AgentTranscriptEntry[] = [];
  private seq = 0;
  /** 当前合并中的 text / reasoning 条目 id；工具或其它条目插入后断开 */
  private openTextId: string | null = null;
  private openReasoningId: string | null = null;
  /** 变更版本号：调用方据此节流 flush */
  private version = 0;

  /** 处理一条子会话流事件；返回是否产生了变更 */
  push(event: AgentStreamEvent): boolean {
    switch (event.type) {
      case "delta":
        this.appendOpen("text", event.text);
        return true;
      case "reasoning_delta":
        this.appendOpen("reasoning", event.text);
        return true;
      case "tool_start":
        this.openTextId = null;
        this.openReasoningId = null;
        this.entries.push({
          id: `tool:${event.toolCallId}`,
          t: Date.now(),
          kind: "tool",
          text: event.toolName,
          toolName: event.toolName,
          args: truncateArgs(event.args),
          state: "running",
        });
        this.trim();
        this.version += 1;
        return true;
      case "tool_end": {
        const entry = this.findTool(event.toolCallId);
        if (entry) {
          entry.state = event.state ?? (event.ok ? "ok" : "error");
          entry.summary = truncateText(event.summary, 400);
          if (entry.state === "denied" || !event.ok) {
            entry.text = truncateText(event.summary, 400);
          }
          const output = typeof event.output === "string" ? event.output : undefined;
          if (output) {
            entry.output = truncateText(output, MAX_OUTPUT_CHARS);
          }
        } else {
          // 未见 tool_start（如恢复/重放）：兜底补一条
          this.entries.push({
            id: `e${this.seq++}`,
            t: Date.now(),
            kind: "tool",
            text: truncateText(event.summary, 400),
            toolName: event.toolName,
            state: event.state ?? (event.ok ? "ok" : "error"),
            summary: truncateText(event.summary, 400),
          });
          this.trim();
        }
        this.version += 1;
        return true;
      }
      case "tool_input_start":
        return false;
      case "tool_progress": {
        const entry = this.findTool(event.event.toolCallId);
        if (entry && entry.state === "running") {
          entry.summary = truncateText(event.event.message, 400);
          this.version += 1;
          return true;
        }
        return false;
      }
      case "ask_user":
        this.openTextId = null;
        this.openReasoningId = null;
        this.entries.push({
          id: `e${this.seq++}`,
          t: Date.now(),
          kind: "ask",
          text: truncateText(event.question.question, 400),
        });
        this.trim();
        this.version += 1;
        return true;
      case "ask_resolved":
        this.entries.push({
          id: `e${this.seq++}`,
          t: Date.now(),
          kind: "ask",
          text: truncateText(`回答：${event.answer}`, 400),
        });
        this.trim();
        this.version += 1;
        return true;
      case "error":
        this.openTextId = null;
        this.openReasoningId = null;
        this.entries.push({
          id: `e${this.seq++}`,
          t: Date.now(),
          kind: "error",
          text: truncateText(event.message, 800),
        });
        this.trim();
        this.version += 1;
        return true;
      default:
        return false;
    }
  }

  /** 自上次取走后的变更版本号：0 表示无变更（调用方可跳过 flush） */
  get revision(): number {
    return this.version;
  }

  snapshot(): AgentTranscriptEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  private findTool(toolCallId: string): AgentTranscriptEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i -= 1) {
      const entry = this.entries[i];
      if (entry && entry.kind === "tool" && entry.id === `tool:${toolCallId}`) {
        return entry;
      }
    }
    return undefined;
  }

  /** 追加到当前合并条目；无则新建。工具等条目插入后重新开一条 */
  private appendOpen(kind: "text" | "reasoning", text: string): void {
    const slot = kind === "text" ? "openTextId" : "openReasoningId";
    const id = this[slot];
    const last = id ? this.entries[this.entries.length - 1] : undefined;
    if (id && last && last.id === id && last.kind === kind) {
      last.text = truncateText(last.text + text, MAX_TEXT_CHARS);
      last.t = Date.now();
      this.version += 1;
      return;
    }
    const newId = `e${this.seq++}`;
    this[slot] = newId;
    this.entries.push({ id: newId, t: Date.now(), kind, text: truncateText(text, MAX_TEXT_CHARS) });
    this.trim();
    this.version += 1;
  }

  /** 条目数超限时丢最老的 text/reasoning（工具/ask/错误保留） */
  private trim(): void {
    if (this.entries.length <= MAX_ENTRIES) {
      return;
    }
    for (let i = 0; i < this.entries.length && this.entries.length > MAX_ENTRIES; i += 1) {
      const entry = this.entries[i];
      if (entry && (entry.kind === "text" || entry.kind === "reasoning")) {
        if (entry.id === this.openTextId) {
          this.openTextId = null;
        }
        if (entry.id === this.openReasoningId) {
          this.openReasoningId = null;
        }
        this.entries.splice(i, 1);
        i -= 1;
      }
    }
    // 全是非文本仍超限（理论极端）：直接丢最老
    while (this.entries.length > MAX_ENTRIES) {
      this.entries.shift();
    }
  }
}
