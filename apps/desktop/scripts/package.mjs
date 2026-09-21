#!/usr/bin/env node
/**
 * 交互式/命令行打包脚本：选择平台与架构，询问版本策略，
 * 先 electron-vite build 再 electron-builder。
 *
 * 用法（pnpm 传参需加 --）：
 *   pnpm package                     # 交互式：目标 + 版本
 *   pnpm package -- mac              # macOS 当前架构；版本仍会询问
 *   pnpm package -- mac --keep-version
 *   pnpm package -- mac --bump patch|minor|major
 *   pnpm package -- mac --version 0.2.0
 *   pnpm package -- mac --skip-build
 *
 * 版本策略：
 *   - 维持版本：不改 package.json，已安装客户端不会因版本号变化提示更新
 *   - 更新版本：写入新版本后再打包；若 updates:serve(默认 :8899) 在跑，
 *     已安装应用检查更新即可看到新版本
 *
 * 平台备注：
 *   - win/linux 从 mac 交叉打包：better-sqlite3 / node-pty 均有 darwin+win32 预编译；
 *     node-pty 没有 linux 预编译，linux 包需在 Linux 机器/容器上构建。
 *   - 未配置代码签名：mac 为 ad-hoc 签名，Windows 安装包会有 SmartScreen 提示。
 */
import { spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = join(desktopDir, "package.json");
const UPDATE_PORT = Number(process.env.UPDATES_PORT || 8899);

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

function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!match) {
    return null;
  }
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

function bumpVersion(version, kind) {
  const parsed = parseSemver(version);
  if (!parsed) {
    throw new Error(`无法解析版本号: ${version}`);
  }
  if (kind === "major") {
    return `${parsed.major + 1}.0.0`;
  }
  if (kind === "minor") {
    return `${parsed.major}.${parsed.minor + 1}.0`;
  }
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

function parseArgs(argv) {
  const tokens = [];
  const flags = { skipBuild: false, keepVersion: false, bump: null, version: null };
  for (const arg of argv) {
    if (arg === "--") {
      continue;
    }
    if (arg === "--skip-build") {
      flags.skipBuild = true;
      continue;
    }
    if (arg === "--keep-version" || arg === "--no-bump") {
      flags.keepVersion = true;
      continue;
    }
    if (arg.startsWith("--bump=")) {
      flags.bump = arg.slice("--bump=".length).toLowerCase();
      continue;
    }
    if (arg === "--bump") {
      flags.bump = "patch";
      continue;
    }
    if (arg.startsWith("--version=")) {
      flags.version = arg.slice("--version=".length);
      continue;
    }
    const maybeBumpIndex = argv.indexOf(arg);
    if (arg === "patch" || arg === "minor" || arg === "major") {
      // pnpm package -- patch 也可
      flags.bump = arg;
      continue;
    }
    void maybeBumpIndex;
    for (const piece of arg.split(",")) {
      const token = normalizeToken(piece);
      if (token && TOKENS[token]) {
        tokens.push(token);
      } else if (token === "patch" || token === "minor" || token === "major") {
        flags.bump = token;
      }
    }
  }
  // `--bump patch` 形式：上一参数是 --bump 时 value 在下一 argv
  const bumpIdx = argv.findIndex((item) => item === "--bump");
  if (bumpIdx >= 0 && argv[bumpIdx + 1] && !argv[bumpIdx + 1].startsWith("-")) {
    const next = argv[bumpIdx + 1].toLowerCase();
    if (["patch", "minor", "major"].includes(next)) {
      flags.bump = next;
    }
  }
  const verIdx = argv.findIndex((item) => item === "--version");
  if (verIdx >= 0 && argv[verIdx + 1] && !argv[verIdx + 1].startsWith("-")) {
    flags.version = argv[verIdx + 1];
  }
  return { tokens, flags };
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

/**
 * 版本策略：打包前决定（产物与 latest-*.yml 必须带目标版本）。
 * 返回 { action: 'keep'|'bump'|'set', version, previous }
 */
async function resolveVersionAction(flags) {
  const pkg = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const current = pkg.version;

  if (flags.version) {
    const parsed = parseSemver(flags.version);
    if (!parsed) {
      throw new Error(`无效版本号: ${flags.version}`);
    }
    return { action: "set", version: flags.version, previous: current };
  }
  if (flags.keepVersion) {
    return { action: "keep", version: current, previous: current };
  }
  if (flags.bump) {
    return { action: "bump", version: bumpVersion(current, flags.bump), previous: current };
  }
  if (!process.stdin.isTTY) {
    // 非交互且未指定：默认维持版本，避免 CI/脚本被卡住
    console.log(`\n（非交互）维持当前版本 ${current}；可用 --bump patch 升版本`);
    return { action: "keep", version: current, previous: current };
  }

  const patch = bumpVersion(current, "patch");
  const minor = bumpVersion(current, "minor");
  const major = bumpVersion(current, "major");
  console.log(`\n当前版本: ${current}`);
  console.log("打包前选择版本策略：");
  console.log(`  1. 维持版本 ${current}（已安装应用不会因版本号提示更新）`);
  console.log(`  2. 更新版本 patch → ${patch}（推荐，可触发在线更新）`);
  console.log(`  3. 更新版本 minor → ${minor}`);
  console.log(`  4. 更新版本 major → ${major}`);
  console.log("  5. 手动输入版本号");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question("选择 [2]: ")).trim() || "2";
  if (answer === "5") {
    const custom = (await rl.question("输入版本 (x.y.z): ")).trim();
    rl.close();
    const parsed = parseSemver(custom);
    if (!parsed) {
      throw new Error(`无效版本号: ${custom}`);
    }
    return { action: "set", version: custom, previous: current };
  }
  rl.close();
  const map = {
    1: { action: "keep", version: current },
    2: { action: "bump", version: patch },
    3: { action: "bump", version: minor },
    4: { action: "bump", version: major },
  };
  const picked = map[answer] ?? map[2];
  return { ...picked, previous: current };
}

async function writePackageVersion(version) {
  const raw = await fs.readFile(packageJsonPath, "utf8");
  const pkg = JSON.parse(raw);
  pkg.version = version;
  await fs.writeFile(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8");
}

async function isUpdatesServeRunning(port = UPDATE_PORT) {
  return new Promise((resolvePromise) => {
    const req = spawn(
      process.platform === "win32" ? "netstat" : "lsof",
      process.platform === "win32"
        ? ["-ano"]
        : ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    let out = "";
    req.stdout?.on("data", (chunk) => {
      out += String(chunk);
    });
    req.on("close", () => {
      resolvePromise(out.includes(String(port)));
    });
    req.on("error", () => resolvePromise(false));
  });
}

function startUpdatesServeDetached() {
  const child = spawn(process.execPath, [join(desktopDir, "scripts/updates-server.mjs")], {
    cwd: desktopDir,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

async function main() {
  const { tokens: argTokens, flags } = parseArgs(process.argv.slice(2));
  let tokens = argTokens;
  if (!tokens.length) {
    tokens = await promptTargets();
  }
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

  const versionPlan = await resolveVersionAction(flags);
  if (versionPlan.action === "keep") {
    console.log(`\n版本策略: 维持 ${versionPlan.version}`);
  } else {
    console.log(
      `\n版本策略: 更新 ${versionPlan.previous} → ${versionPlan.version}（写入 package.json 后打包）`,
    );
    await writePackageVersion(versionPlan.version);
  }

  console.log(`\n打包目标: ${normalized.join(", ")}`);
  if (!flags.skipBuild) {
    console.log("\n▶ electron-vite build");
    run("npx", ["electron-vite", "build"]);
  }

  const builderArgs = normalized.flatMap((token) => TOKENS[token]);
  console.log(`\n▶ electron-builder ${builderArgs.join(" ")}`);
  run("npx", ["electron-builder", ...builderArgs]);

  const serveRunning = await isUpdatesServeRunning();
  console.log(`\n✓ 完成，产物在 apps/desktop/release/（版本 ${versionPlan.version}）`);
  console.log(`  更新源清单: release/latest-mac.yml（及对应平台 yml）`);

  if (versionPlan.action === "keep") {
    console.log(`\n· 维持版本 ${versionPlan.version}：已安装应用不会因版本号收到更新提示。`);
    console.log(`  若要让客户端可更新，请重新 package 并选择「更新版本」。`);
    return;
  }

  if (serveRunning) {
    console.log(`\n· updates:serve 已在 :${UPDATE_PORT} 运行`);
    console.log(`  已安装且更新源指向 http://127.0.0.1:${UPDATE_PORT} 的应用，检查更新即可看到 v${versionPlan.version}。`);
  } else {
    console.log(`\n· 未检测到 updates:serve（:${UPDATE_PORT}）`);
    if (process.stdin.isTTY) {
      const rl = createInterface({ input: process.stdin, output: process.stdout });
      const start = (await rl.question("是否现在启动 updates:serve？[Y/n] ")).trim().toLowerCase();
      rl.close();
      if (!start || start === "y" || start === "yes") {
        startUpdatesServeDetached();
        await new Promise((r) => setTimeout(r, 400));
        const up = await isUpdatesServeRunning();
        console.log(
          up
            ? `  已后台启动 updates:serve → http://127.0.0.1:${UPDATE_PORT}`
            : `  启动命令已发出；若未生效请手动: pnpm updates:serve`,
        );
      } else {
        console.log(`  之后可手动启动: pnpm --filter @zen/desktop updates:serve`);
      }
    } else {
      console.log(`  启动更新源: pnpm --filter @zen/desktop updates:serve`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
