import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { extractServerMap, parseJsonc, parseToml, toConfig } from "./mcp-scan-parse";
import { buildCandidates, type ScanContext } from "./mcp-scan-providers";
import { scanMcpSources } from "./mcp-scan";

import type { McpServerConfig } from "@zen/shared";

const roots: string[] = [];

function makeRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), "zen-mcp-scan-"));
  roots.push(dir);
  return dir;
}

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function ctxFor(platform: NodeJS.Platform, home: string, env: Record<string, string | undefined> = {}): ScanContext {
  return { home, platform, env };
}

afterEach(() => {
  while (roots.length) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe("parseToml（Codex config.toml 子集）", () => {
  it("解析 [mcp_servers.*] 与 env 子表", () => {
    const data = parseToml(`
# 顶层注释
model = "gpt"
[mcp_servers.node_repl]
args = ["--quiet", "x"] # 行尾注释
command = "/usr/bin/repl"
startup_timeout_sec = 120
enabled = false

[mcp_servers.node_repl.env]
FOO = "bar"
NUM = 3

[mcp_servers.remote]
url = "https://example.com/mcp"
http_headers = { Authorization = "Bearer t" }

[unrelated.table]
key = "v"
`);
    const servers = data["mcp_servers"] as Record<string, Record<string, unknown>>;
    expect(servers["node_repl"]?.["command"]).toBe("/usr/bin/repl");
    expect(servers["node_repl"]?.["args"]).toEqual(["--quiet", "x"]);
    expect(servers["node_repl"]?.["enabled"]).toBe(false);
    expect(servers["node_repl"]?.["env"]).toEqual({ FOO: "bar", NUM: 3 });
    expect(servers["remote"]?.["url"]).toBe("https://example.com/mcp");
    expect(servers["remote"]?.["http_headers"]).toEqual({ Authorization: "Bearer t" });
  });
});

describe("parseJsonc（MiMo mimocode.jsonc）", () => {
  it("去掉注释与尾逗号", () => {
    const data = parseJsonc(`{
  // 行注释
  "mcp": {
    "a": { "type": "local", "command": ["npx", "-y", "x"], },
    /* 块注释 */
    "b": { "type": "remote", "url": "https://e/mcp" },
  },
}`) as Record<string, unknown>;
    expect(Object.keys(data["mcp"] as object)).toEqual(["a", "b"]);
  });
});

describe("toConfig 条目归一", () => {
  it("MiMo local：command 数组 + environment", () => {
    const config = toConfig("id", "mimo-local", {
      type: "local",
      command: ["npx", "-y", "@playwright/mcp"],
      environment: { A: "1" },
      enabled: false,
    });
    expect(config).toMatchObject({
      transport: "stdio",
      command: "npx",
      args: ["-y", "@playwright/mcp"],
      env: { A: "1" },
      enabled: false,
    });
  });

  it("Gemini：httpUrl / sseUrl", () => {
    expect(
      toConfig("id", "g1", { httpUrl: "https://e/mcp", headers: { H: "1" } }),
    ).toMatchObject({ transport: "http", url: "https://e/mcp", headers: { H: "1" } });
    expect(toConfig("id", "g2", { sseUrl: "https://e/sse" })).toMatchObject({
      transport: "sse",
      url: "https://e/sse",
    });
  });

  it("DimAgent：authorizationToken 收进 Authorization 头", () => {
    const config = toConfig("id", "dim", {
      type: "url",
      name: "dim",
      url: "https://e/mcp",
      authorizationToken: "tok",
    });
    expect(config).toMatchObject({
      transport: "http",
      url: "https://e/mcp",
      headers: { Authorization: "Bearer tok" },
    });
  });

  it("无 command / url 的垃圾条目返回 null", () => {
    expect(toConfig("id", "junk", { foo: 1 })).toBeNull();
  });
});

describe("scanMcpSources：macOS 全来源矩阵", () => {
  it("发现各工具配置并去重合并", async () => {
    const root = makeRoot();
    const home = join(root, "home");
    const appData = join(home, "Library", "Application Support");
    const ws = join(root, "ws");

    write(
      join(home, ".codex", "config.toml"),
      `[mcp_servers.codex-toml]\nargs = ["a"]\ncommand = "codex-cmd"\n\n[mcp_servers.codex-toml.env]\nK = "v"\n\n[mcp_servers.codex-off]\ncommand = "off-cmd"\nenabled = false\n`,
    );
    write(
      join(home, ".claude.json"),
      JSON.stringify({
        mcpServers: { "cc-user": { command: "cc-cmd", args: ["u"] } },
        projects: { [ws]: { mcpServers: { "cc-proj": { command: "cc-proj-cmd" } } } },
      }),
    );
    write(
      join(appData, "Claude", "claude_desktop_config.json"),
      JSON.stringify({ mcpServers: { desk: { command: "desk-cmd", args: [], env: { E: "1" } } } }),
    );
    write(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { cursor: { command: "cur-cmd" }, dup: { command: "dup-cmd" } } }),
    );
    write(
      join(appData, "Code", "User", "mcp.json"),
      JSON.stringify({
        servers: {
          "vscode-http": { type: "http", url: "https://e/mcp", headers: { H: "1" } },
          "vscode-sse": { type: "sse", url: "https://e/sse" },
        },
      }),
    );
    write(
      join(appData, "Code", "User", "profiles", "prof1", "mcp.json"),
      JSON.stringify({ servers: { "vscode-profile": { type: "stdio", command: "prof-cmd" } } }),
    );
    write(
      join(appData, "Code - Insiders", "User", "mcp.json"),
      JSON.stringify({ servers: { insiders: { command: "ins-cmd" } } }),
    );
    write(
      join(home, ".codeium", "windsurf", "mcp_config.json"),
      JSON.stringify({ mcpServers: { windsurf: { command: "ws-cmd" } } }),
    );
    write(
      join(appData, "Trae", "User", "mcp.json"),
      JSON.stringify({ servers: { trae: { command: "trae-cmd" } } }),
    );
    write(
      join(home, ".gemini", "settings.json"),
      JSON.stringify({
        theme: "dark",
        mcpServers: {
          "gem-local": { command: "gem", args: ["x"], env: { G: "1" } },
          "gem-remote": { httpUrl: "https://e/gem", headers: { T: "2" } },
          "gem-sse": { sseUrl: "https://e/gem-sse" },
        },
      }),
    );
    write(
      join(home, ".config", "mimocode", "mimocode.jsonc"),
      `{
  // MiMoCode
  "mcp": {
    "mimo-local": { "type": "local", "command": ["mimo-cmd", "-y"], "environment": { "M": "1" } },
    "mimo-remote": { "type": "remote", "url": "http://127.0.0.1:3845/mcp" },
  },
}`,
    );
    write(
      join(home, ".dimcode", "v2", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          dim: { command: "dim-cmd" },
          "dim-url": { type: "url", name: "dim-url", url: "https://e/dim", authorizationToken: "tok" },
        },
      }),
    );
    write(join(ws, ".mcp.json"), JSON.stringify({ mcpServers: { dup: { command: "dup-cmd" }, "ws-only": { command: "ws-cmd" } } }));
    write(join(ws, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { "ws-cursor": { command: "wc" } } }));
    write(join(ws, ".vscode", "mcp.json"), JSON.stringify({ servers: { "ws-vscode": { type: "http", url: "https://e/ws" } } }));
    write(join(ws, ".gemini", "settings.json"), JSON.stringify({ mcpServers: { "ws-gemini": { command: "wg" } } }));
    write(join(ws, ".mimocode", "mimocode.jsonc"), JSON.stringify({ mcp: { "ws-mimo": { type: "local", command: ["wm"] } } }));

    const existing: McpServerConfig[] = [
      { id: "e1", name: "desk", transport: "stdio", command: "other", args: [], enabled: true },
      { id: "e2", name: "other-name", transport: "stdio", command: "cur-cmd", args: [], enabled: true },
    ];
    const found = await scanMcpSources(ws, existing, ctxFor("darwin", home));
    const byName = new Map(found.map((item) => [item.config.name, item]));

    // 用户级
    expect(byName.get("codex-toml")).toMatchObject({
      source: "OpenAI Codex CLI",
      config: { transport: "stdio", command: "codex-cmd", args: ["a"], env: { K: "v" }, enabled: true },
    });
    expect(byName.get("codex-off")).toMatchObject({ config: { enabled: false } });
    expect(byName.get("cc-user")).toMatchObject({ source: "Claude Code" });
    expect(byName.get("cc-proj")).toMatchObject({ source: "Claude Code（本项目）" });
    expect(byName.get("desk")).toMatchObject({
      source: "Claude Desktop",
      config: { env: { E: "1" } },
      alreadyImported: true,
    });
    expect(byName.get("cursor")).toMatchObject({ source: "Cursor", alreadyImported: true });
    expect(byName.get("vscode-http")).toMatchObject({
      source: "VS Code",
      config: { transport: "http", url: "https://e/mcp", headers: { H: "1" } },
    });
    expect(byName.get("vscode-sse")).toMatchObject({ config: { transport: "sse" } });
    expect(byName.get("vscode-profile")).toMatchObject({ source: "VS Code（配置文件）" });
    expect(byName.get("insiders")).toMatchObject({ source: "VS Code Insiders" });
    expect(byName.get("windsurf")).toMatchObject({ source: "Windsurf" });
    expect(byName.get("trae")).toMatchObject({ source: "Trae" });
    expect(byName.get("gem-local")).toMatchObject({ source: "Gemini CLI", config: { env: { G: "1" } } });
    expect(byName.get("gem-remote")).toMatchObject({ config: { transport: "http", url: "https://e/gem" } });
    expect(byName.get("gem-sse")).toMatchObject({ config: { transport: "sse" } });
    expect(byName.get("mimo-local")).toMatchObject({
      source: "MiMo",
      config: { transport: "stdio", command: "mimo-cmd", args: ["-y"], env: { M: "1" } },
    });
    expect(byName.get("mimo-remote")).toMatchObject({ config: { transport: "http", url: "http://127.0.0.1:3845/mcp" } });
    expect(byName.get("dim")).toMatchObject({ source: "DimAgent" });
    expect(byName.get("dim-url")).toMatchObject({
      config: { transport: "http", headers: { Authorization: "Bearer tok" } },
    });

    // 项目级
    expect(byName.get("ws-only")).toMatchObject({ source: "当前仓库 (.mcp.json)" });
    expect(byName.get("ws-cursor")).toMatchObject({ source: "当前仓库 (.cursor/mcp.json)" });
    expect(byName.get("ws-vscode")).toMatchObject({ source: "当前仓库 (.vscode/mcp.json)" });
    expect(byName.get("ws-gemini")).toMatchObject({ source: "当前仓库 (.gemini/settings.json)" });
    expect(byName.get("ws-mimo")).toMatchObject({ source: "当前仓库 (.mimocode)" });

    // 跨来源去重：dup 在 Cursor 与 .mcp.json 都有，只留第一次（用户级先扫描）
    const dups = found.filter((item) => item.config.name === "dup");
    expect(dups).toHaveLength(1);
    expect(dups[0]?.source).toBe("Cursor");

    // 输出结构：来源 / 名称 / 传输 / 端点 / 原始路径
    const sample = byName.get("vscode-http");
    expect(sample?.sourcePath).toBe(join(appData, "Code", "User", "mcp.json"));
    expect(sample?.config.name).toBe("vscode-http");
    expect(sample?.config.transport).toBe("http");
    expect(sample?.config.url).toBe("https://e/mcp");
    expect(sample?.config.headers).toEqual({ H: "1" });
  });
});

describe("scanMcpSources：Windows / Linux 路由", () => {
  it("Windows：%APPDATA% + %USERPROFILE%", async () => {
    const home = makeRoot();
    const appData = join(home, "AppData", "Roaming");
    write(
      join(appData, "Claude", "claude_desktop_config.json"),
      JSON.stringify({ mcpServers: { desk: { command: "d" } } }),
    );
    write(join(appData, "Code", "User", "mcp.json"), JSON.stringify({ servers: { vs: { command: "v" } } }));
    write(join(appData, "Trae CN", "User", "mcp.json"), JSON.stringify({ servers: { trae: { command: "t" } } }));
    write(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { cur: { command: "c" } } }));

    const found = await scanMcpSources(undefined, [], ctxFor("win32", home, { APPDATA: appData }));
    const sources = new Map(found.map((item) => [item.config.name, item.source]));
    expect(sources.get("desk")).toBe("Claude Desktop");
    expect(sources.get("vs")).toBe("VS Code");
    expect(sources.get("trae")).toBe("Trae");
    expect(sources.get("cur")).toBe("Cursor");
  });

  it("Linux：XDG_CONFIG_HOME", async () => {
    const home = makeRoot();
    const xdg = join(home, ".xdg");
    write(
      join(xdg, "Claude", "claude_desktop_config.json"),
      JSON.stringify({ mcpServers: { desk: { command: "d" } } }),
    );
    write(join(xdg, "Code", "User", "mcp.json"), JSON.stringify({ servers: { vs: { command: "v" } } }));
    write(join(xdg, "mimocode", "mimocode.jsonc"), JSON.stringify({ mcp: { mimo: { type: "local", command: ["m"] } } }));

    const found = await scanMcpSources(undefined, [], ctxFor("linux", home, { XDG_CONFIG_HOME: xdg }));
    const sources = new Map(found.map((item) => [item.config.name, item.source]));
    expect(sources.get("desk")).toBe("Claude Desktop");
    expect(sources.get("vs")).toBe("VS Code");
    expect(sources.get("mimo")).toBe("MiMo");
  });

  it("buildCandidates：三平台关键路径分支", () => {
    const home = "/home/u";
    const mac = buildCandidates(ctxFor("darwin", home));
    const win = buildCandidates(ctxFor("win32", home, { APPDATA: "/appdata" }));
    const lin = buildCandidates(ctxFor("linux", home, { XDG_CONFIG_HOME: "/xdg" }));
    const pick = (list: typeof mac, source: string) =>
      list.find((item) => item.source === source)?.path;

    expect(pick(mac, "Claude Desktop")).toBe(join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"));
    expect(pick(win, "Claude Desktop")).toBe(join("/appdata", "Claude", "claude_desktop_config.json"));
    expect(pick(lin, "Claude Desktop")).toBe(join("/xdg", "Claude", "claude_desktop_config.json"));
    expect(pick(mac, "VS Code")).toBe(join(home, "Library", "Application Support", "Code", "User", "mcp.json"));
    expect(pick(win, "VS Code")).toBe(join("/appdata", "Code", "User", "mcp.json"));
    expect(pick(lin, "VS Code")).toBe(join("/xdg", "Code", "User", "mcp.json"));
    expect(pick(mac, "Cursor")).toBe(join(home, ".cursor", "mcp.json"));
    expect(pick(win, "OpenAI Codex CLI")).toBe(join(home, ".codex", "config.toml"));
    expect(pick(lin, "Gemini CLI")).toBe(join(home, ".gemini", "settings.json"));
    expect(pick(mac, "DimAgent")).toBe(join(home, ".dimcode", "v2", "mcp.json"));
  });
});

describe("expandValue（~ 与 ${VAR} 展开）", () => {
  it("toConfig 展开 command / args / env / url", () => {
    const config = toConfig(
      "id",
      "exp",
      {
        command: "node",
        args: ["~/bin/srv.js", "${PROJECT}/x"],
        env: { TOKEN: "${SECRET}" },
      },
      { home: "/Users/u", env: { SECRET: "s1", PROJECT: "/prj" } },
    );
    expect(config).toMatchObject({
      command: "node",
      args: ["/Users/u/bin/srv.js", "/prj/x"],
      env: { TOKEN: "s1" },
    });
    expect(
      toConfig("id", "u", { url: "${API_HOST}/mcp" }, { home: "/h", env: { API_HOST: "http://e" } }),
    ).toMatchObject({ url: "http://e/mcp" });
    // 未定义的变量保持原样
    expect(
      toConfig("id", "k", { command: "x", args: ["${MISSING}"] }, { home: "/h", env: {} }),
    ).toMatchObject({ args: ["${MISSING}"] });
  });
});

describe("VS Code settings.json 的 mcp 键", () => {
  it("扫描用户级 settings.json（JSONC）", async () => {
    const home = makeRoot();
    const appData = join(home, "Library", "Application Support");
    write(
      join(appData, "Code", "User", "settings.json"),
      `{\n  // 用户设置\n  "mcp": {\n    "in-settings": { "command": "set-cmd" },\n  },\n}`,
    );
    const found = await scanMcpSources(undefined, [], ctxFor("darwin", home));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ source: "VS Code settings", config: { command: "set-cmd" } });
  });
});

describe("容错与去重", () => {
  it("坏 JSON / 坏 TOML 跳过不崩，好文件照常发现", async () => {
    const home = makeRoot();
    write(join(home, ".cursor", "mcp.json"), "{ 这不是 JSON");
    write(join(home, ".codex", "config.toml"), "[mcp_servers.x\ncommand = ");
    write(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { ok: { command: "c" }, bad: { nothing: true } } }),
    );
    const found = await scanMcpSources(undefined, [], ctxFor("darwin", home));
    expect(found.map((item) => item.config.name)).toEqual(["ok"]);
  });

  it("DimAgent 数组形态 mcpServers 也可解析", () => {
    const map = extractServerMap({
      mcpServers: [{ type: "url", name: "arr", url: "https://e", authorizationToken: "t" }],
    });
    expect(Object.keys(map)).toEqual(["arr"]);
    expect(toConfig("id", "arr", map["arr"] as Record<string, unknown>)).toMatchObject({
      transport: "http",
      headers: { Authorization: "Bearer t" },
    });
  });

  it("同名同端点跨文件只保留一条；同名不同端点都保留", async () => {
    const home = makeRoot();
    const ws = join(home, "ws");
    write(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { same: { command: "c", args: ["1"] } } }));
    write(join(home, ".codeium", "windsurf", "mcp_config.json"), JSON.stringify({ mcpServers: { same: { command: "c", args: ["1"] } } }));
    write(join(ws, ".mcp.json"), JSON.stringify({ mcpServers: { same: { command: "other" } } }));

    const found = await scanMcpSources(ws, [], ctxFor("darwin", home));
    const same = found.filter((item) => item.config.name === "same");
    expect(same).toHaveLength(2);
    expect(same[0]?.config.command).toBe("c");
    expect(same[0]?.source).toBe("Cursor");
    expect(same[1]?.config.command).toBe("other");
    expect(same[1]?.source).toBe("当前仓库 (.mcp.json)");
  });
});
