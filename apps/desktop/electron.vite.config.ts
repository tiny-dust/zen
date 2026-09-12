import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import vue from "@vitejs/plugin-vue";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

const dirname = fileURLToPath(new URL(".", import.meta.url));
const uiRoot = resolve(dirname, "../ui");
const sharedSrc = resolve(dirname, "../../packages/shared/src/index.ts");
const agentCoreSrc = resolve(dirname, "../../packages/agent-core/src/index.ts");

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@zen/shared", "@zen/agent-core"] })],
    resolve: {
      alias: {
        "@zen/shared": sharedSrc,
        "@zen/agent-core": agentCoreSrc,
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@zen/shared"] })],
    resolve: {
      alias: {
        "@zen/shared": sharedSrc,
      },
    },
  },
  renderer: {
    root: uiRoot,
    plugins: [vue()],
    resolve: {
      alias: {
        "@": resolve(uiRoot, "src"),
        "@zen/shared": sharedSrc,
      },
    },
    build: {
      rollupOptions: {
        input: resolve(uiRoot, "index.html"),
      },
    },
  },
});
