import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const dirname = fileURLToPath(new URL(".", import.meta.url));
const uiRoot = resolve(dirname, "../ui");
const packagesRoot = resolve(dirname, "../../packages");
const sharedSrc = resolve(packagesRoot, "shared/src/index.ts");
const agentCoreSrc = resolve(packagesRoot, "agent-core/src/index.ts");

/**
 * 工作区 @zen/* 包全部打进 bundle（别名指向 TS 源码）。
 * 这些包以 TS 源码被 externalize 时，打包后落在 asar/node_modules 下，
 * 而 Node 22 禁止对 node_modules 内文件做类型剥离（ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING）。
 */
function workspacePackageAliases(): Record<string, string> {
  const aliases: Record<string, string> = {};
  const roots = [packagesRoot, resolve(packagesRoot, "tools")];
  for (const root of roots) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      try {
        const pkg = JSON.parse(readFileSync(resolve(root, entry.name, "package.json"), "utf8")) as {
          name?: string;
        };
        if (typeof pkg.name === "string" && pkg.name.startsWith("@zen/")) {
          aliases[pkg.name] = resolve(root, entry.name, "src/index.ts");
        }
      } catch {
        // 跳过没有 package.json 的目录
      }
    }
  }
  return aliases;
}

const workspaceAliases = workspacePackageAliases();
const workspaceNames = Object.keys(workspaceAliases);

export default defineConfig({
  main: {
    clearScreen: false,
    plugins: [externalizeDepsPlugin({ exclude: workspaceNames })],
    resolve: {
      alias: {
        ...workspaceAliases,
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(dirname, "src/main/index.ts"),
        },
      },
      watch: {},
    },
  },
  preload: {
    clearScreen: false,
    plugins: [externalizeDepsPlugin({ exclude: workspaceNames })],
    resolve: {
      alias: {
        ...workspaceAliases,
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(dirname, "src/preload/index.ts"),
        },
      },
      watch: {},
    },
  },
  renderer: {
    root: uiRoot,
    clearScreen: false,
    plugins: [
      vue(),
      // monorepo: electron-vite renderer root is apps/ui; keep Tailwind scan base there
      tailwindcss({ base: uiRoot } as never),
    ],
    resolve: {
      alias: {
        "@": resolve(uiRoot, "src"),
        "@zen/shared": sharedSrc,
      },
    },
    server: {
      port: 10011,
      strictPort: true,
      watch: {
        // monorepo packages live outside apps/ui; still hot-update on their edits
        ignored: ["**/node_modules/**", "**/dist/**", "**/out/**", "**/.git/**"],
      },
    },
    build: {
      rollupOptions: {
        input: resolve(uiRoot, "index.html"),
      },
    },
  },
});
