import type { McpTransport } from "./mcp";

/** 知名 MCP 服务预设：选中后预填表单，路径/令牌类参数由用户补全 */
export interface McpServerPreset {
  id: string;
  name: string;
  transport: McpTransport;
  description: string;
  /** stdio：启动命令（不含参数） */
  command?: string;
  /** stdio：参数模板，{path}/{token} 等占位由用户输入替换 */
  args?: string[];
  /** stdio：需要的环境变量 */
  env?: Record<string, string>;
  /** sse / http：服务地址 */
  url?: string;
  /** 需要用户补全的占位说明（展示在预设旁） */
  requires?: string[];
}

const NPX = "npx";

export const MCP_SERVER_PRESETS: McpServerPreset[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    transport: "stdio",
    description: "官方文件系统读写（指定目录沙箱）",
    command: NPX,
    args: ["-y", "@modelcontextprotocol/server-filesystem", "{path}"],
    requires: ["{path} = 授权访问的目录"],
  },
  {
    id: "memory",
    name: "Memory",
    transport: "stdio",
    description: "官方知识图谱记忆，跨会话记住事实",
    command: NPX,
    args: ["-y", "@modelcontextprotocol/server-memory"],
  },
  {
    id: "sequential-thinking",
    name: "Sequential Thinking",
    transport: "stdio",
    description: "官方分步推理工具，适合复杂任务拆解",
    command: NPX,
    args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
  },
  {
    id: "fetch",
    name: "Fetch",
    transport: "stdio",
    description: "官方网页抓取，取回 URL 内容转 markdown",
    command: "uvx",
    args: ["mcp-server-fetch"],
  },
  {
    id: "context7",
    name: "Context7",
    transport: "stdio",
    description: "Upstash 库文档查询，拿最新框架 API",
    command: NPX,
    args: ["-y", "@upstash/context7-mcp"],
  },
  {
    id: "playwright",
    name: "Playwright",
    transport: "stdio",
    description: "微软浏览器自动化：导航、点击、截图",
    command: NPX,
    args: ["-y", "@playwright/mcp@latest"],
  },
  {
    id: "notion",
    name: "Notion",
    transport: "http",
    description: "Notion 官方托管（Streamable HTTP，新版协议）",
    url: "https://mcp.notion.com/mcp",
    requires: ["首次连接走 OAuth 授权"],
  },
  {
    id: "sentry",
    name: "Sentry",
    transport: "http",
    description: "Sentry 官方托管：查报错、堆栈与发布",
    url: "https://mcp.sentry.dev/mcp",
    requires: ["首次连接走 OAuth 授权"],
  },
  {
    id: "linear",
    name: "Linear",
    transport: "sse",
    description: "Linear 官方托管（SSE，旧版协议）",
    url: "https://mcp.linear.app/sse",
    requires: ["首次连接走 OAuth 授权"],
  },
  {
    id: "figma",
    name: "Figma",
    transport: "http",
    description: "Figma 官方托管：读设计稿与设计数据",
    url: "https://mcp.figma.com/mcp",
    requires: ["需在 URL/头里带 Figma 令牌"],
  },
];
