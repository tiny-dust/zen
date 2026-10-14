import { describe, expect, it } from "vitest";

import {
  MCP_TOOL_NAME_MAX,
  isMcpToolName,
  mcpToolWireName,
  parseMcpToolName,
} from "./mcp-tool-name";

describe("mcpToolWireName", () => {
  it("三段名点号替换为双下划线，匹配 Anthropic 工具名 pattern", () => {
    const name = mcpToolWireName("mobbin", "search_screens");
    expect(name).toBe("mcp__mobbin__search_screens");
    expect(name).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("server/tool 内非法字符（中文、点、空格）统一替换为 _", () => {
    expect(mcpToolWireName("飞书.企业版", "send message")).toBe("mcp__________send_message");
  });

  it("超长截断到上限内", () => {
    const name = mcpToolWireName("a".repeat(80), "b".repeat(80));
    expect(name.length).toBe(MCP_TOOL_NAME_MAX);
    expect(name.startsWith("mcp__")).toBe(true);
  });
});

describe("parseMcpToolName", () => {
  it("还原 server 与 tool 段（工具段含 __ 时合并）", () => {
    expect(parseMcpToolName("mcp__mobbin__search_screens")).toEqual({
      serverName: "mobbin",
      toolName: "search_screens",
    });
    expect(parseMcpToolName("mcp__a__b__c")).toEqual({ serverName: "a", toolName: "b__c" });
  });

  it("非 MCP 前缀或缺段返回 null", () => {
    expect(parseMcpToolName("readFile")).toBeNull();
    expect(parseMcpToolName("mcp.lark.send")).toBeNull();
    expect(parseMcpToolName("mcp__only-server")).toBeNull();
    expect(parseMcpToolName("mcp__")).toBeNull();
  });
});

describe("isMcpToolName", () => {
  it("按前缀与段落完整性判定", () => {
    expect(isMcpToolName("mcp__lark__send")).toBe(true);
    expect(isMcpToolName("mcp.lark.send")).toBe(false);
    expect(isMcpToolName("mcp__x")).toBe(false);
  });
});
