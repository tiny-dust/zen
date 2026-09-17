#!/usr/bin/env node
/**
 * 交互式/命令行打包脚本：选择平台与架构，先 electron-vite build 再 electron-builder。
 *
 * 用法（pnpm 传参需加 --）：
 *   pnpm package                     # 交互式菜单
 *   pnpm package -- mac              # macOS 当前架构
 *   pnpm package -- mac-arm64 mac-x64 win-x64 linux-x64
 *   pnpm package -- mac-universal    # macOS 通用二进制
 *   pnpm package -- --skip-build     # 跳过 electron-vite build（复用已有 out/）
 *
 * 平台备注：
 *   - win/linux 从 mac 交叉打包：better-sqlite3 / node-pty 均有 darwin+win32 预编译；
 *     node-pty 没有 linux 预编译，linux 包需在 Linux 机器/容器上构建。
 *   - 未配置代码签名：mac 为 ad-hoc 签名，Windows 安装包会有 SmartScreen 提示。
 */
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** 平台 token → electron-builder 参数；平台缺省架构用当前机器 */
const HOST_ARCH = process.arch === "arm64" ? "arm64" : "x64";
const TOKENS = {
  mac: [`--mac`],
  "mac-arm64": [`--mac`, `--arm64`],
  "mac-x64": [`--mac`, `--x64`],
  "mac-universal": [`--mac`, `--universal`],
  win: [`--win`],
  "win-x64": [`--win`, `--x64`],
  "win-arm64": [`--win`, `--arm64`],
  linux: [`--linux`],
  "linux-x64": [`--linux`, `--x64`],
  "linux-arm64": [`--linux`, `--arm64`],
};

const NOTES = {
  linux: "⚠ node-pty 没有 linux 预编译，linux 包需在 Linux 机器/容器上构建（本机交叉打包会失败）",
  win: "Windows 包未签名，运行时会有 SmartScreen 提示",
};

function normalizeToken(raw) {
  return raw.trim().toLowerCase().replace(/^macos$/, "mac").replace(/^windows$/, "win");
}

function parseArgs(argv) {
  const tokens = [];
  let skipBuild = false;
  for (const arg of argv) {
    if (arg === "--") {
      // pnpm 会把分隔符原样透传进来
      continue;
    }
    if (arg === "--skip-build") {
      skipBuild = true;
      continue;
    }
    for (const piece of arg.split(",")) {
      const token = normalizeToken(piece);
      if (token) {
        tokens.push(token);
      }
    }
  }
  return { tokens, skipBuild };
}

function run(command, args, cwd = desktopDir) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n✗ ${command} ${args.join(" ")} 失败（exit ${result.status}）`);
    process.exit(result.status ?? 1);
  }
}

async function promptTargets() {
  const options = [
    { token: `mac-arm64`, label: `macOS（Apple Silicon，当前机器）` },
    { token: `mac-x64`, label: `macOS（Intel）` },
    { token: `mac-universal`, label: `macOS（通用二进制，体积最大）` },
    { token: `win-x64`, label: `Windows（x64）` },
    { token: `win-arm64`, label: `Windows（ARM64）` },
    { token: `linux-x64`, label: `Linux（x64，需在 Linux 上构建）` },
    { token: `linux-arm64`, label: `Linux（ARM64，需在 Linux 上构建）` },
  ];
  console.log("\n选择打包目标（数字，可多选，逗号/空格分隔，回车默认 1）：");
  options.forEach((option, index) => {
    console.log(`  ${index + 1}. ${option.label}`);
  });
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("序号: ")).trim();
  rl.close();
  if (!answer) {
    return [options[0].token];
  }
  const picked = answer
    .split(/[,\s]+/)
    .map((piece) => options[Number(piece) - 1]?.token)
    .filter(Boolean);
  return picked.length ? picked : [options[0].token];
}

async function main() {
  const { tokens: argTokens, skipBuild } = parseArgs(process.argv.slice(2));
  let tokens = argTokens;
  if (!tokens.length) {
    tokens = await promptTargets();
  }
  // 平台不带架构时按当前机器补默认值，保证 electron-builder 参数明确
  const normalized = tokens.map((token) =>
    token === "mac" ? `mac-${HOST_ARCH}` : token === "win" ? `win-${HOST_ARCH}` : token,
  );

  for (const token of normalized) {
    if (!TOKENS[token]) {
      console.error(`未知目标: ${token}（可用: ${Object.keys(TOKENS).join(", ")}）`);
      process.exit(1);
    }
    if (NOTES[token.split("-")[0]]) {
      console.log(`\n${NOTES[token.split("-")[0]]}`);
    }
  }

  console.log(`\n打包目标: ${normalized.join(", ")}`);
  if (!skipBuild) {
    console.log("\n▶ electron-vite build");
    run("npx", ["electron-vite", "build"]);
  }

  const builderArgs = normalized.flatMap((token) => TOKENS[token]);
  console.log(`\n▶ electron-builder ${builderArgs.join(" ")}`);
  run("npx", ["electron-builder", ...builderArgs]);

  console.log("\n✓ 完成，产物在 apps/desktop/release/（latest-mac.yml 为在线更新清单）");
}

main();
