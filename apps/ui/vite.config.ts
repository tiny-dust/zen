import { resolve } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const srcDir = resolve(__dirname, "src");

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss({
      // monorepo: ensure scan root is the UI package
      base: __dirname,
    }),
  ],
  resolve: {
    alias: {
      "@": srcDir,
    },
  },
});