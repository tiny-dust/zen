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

export default defineConfig({
  main: {
    clearScreen: false,
    plugins: [externalizeDepsPlugin({ exclude: ["@zen/shared", "@zen/agent-core"] })],
    resolve: {
      alias: {
        "@zen/shared": sharedSrc,
        "@zen/agent-core": agentCoreSrc,
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
    plugins: [externalizeDepsPlugin({ exclude: ["@zen/shared"] })],
    resolve: {
      alias: {
        "@zen/shared": sharedSrc,
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
