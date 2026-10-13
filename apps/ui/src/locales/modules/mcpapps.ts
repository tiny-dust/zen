import type { LocaleModule } from "../index";

/**
 * MCP Apps 交互 UI（SEP-1865：工具结果返回 HTML 资源，沙箱 iframe 展示）。
 * 键：mcpapps.*（命名空间即文件名 mcpapps）。
 */
export default {
  "zh-CN": {
    mcpapps: {
      frameTitle: "MCP 应用交互视图",
      note: "MCP 工具返回了交互式界面，在沙箱中展示",
      eventReceived: "收到交互事件",
      copyEvent: "复制事件",
      copyEventTitle: "复制最近一次交互事件（JSON）",
      copied: "已复制",
      sendToChat: "回传对话",
      sendToChatTitle: "把最近一次交互事件插入输入框，发送后作为上下文回传给 Agent",
      sandboxNote: "沙箱模式：不加载外部资源",
    },
  },
  "en-US": {
    mcpapps: {
      frameTitle: "MCP app interactive view",
      note: "The MCP tool returned an interactive UI, rendered in a sandbox",
      eventReceived: "Interaction event received",
      copyEvent: "Copy event",
      copyEventTitle: "Copy the latest interaction event (JSON)",
      copied: "Copied",
      sendToChat: "Send to chat",
      sendToChatTitle: "Insert the latest interaction event into the composer; sending returns it to the agent as context",
      sandboxNote: "Sandboxed: no external resources",
    },
  },
} satisfies LocaleModule;
