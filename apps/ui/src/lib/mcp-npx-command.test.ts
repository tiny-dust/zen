import { describe, expect, it } from "vitest";

import { parseNpxCommand } from "./mcp-npx-command";

describe("parseNpxCommand", () => {
  it("从带作用域与版本的包名推断服务名称，并保留启动参数", () => {
    expect(parseNpxCommand('npx -y @modelcontextprotocol/server-filesystem@1.2.3 "~/My Docs"')).toEqual({
      name: "server-filesystem",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem@1.2.3", "~/My Docs"],
    });
  });

  it("自动补齐免交互参数，避免首次下载时卡住", () => {
    expect(parseNpxCommand("npx @playwright/mcp --browser chromium")).toEqual({
      name: "mcp",
      command: "npx",
      args: ["-y", "@playwright/mcp", "--browser", "chromium"],
    });
  });

  it("拒绝非 npx、缺包名、未闭合引号与 shell 运算符", () => {
    for (const command of ["npm install x", "npx -y", "npx -y 'x", "npx -y x; echo wrong", "npx -y x | sh"]) {
      expect(parseNpxCommand(command)).toBeNull();
    }
  });
});
