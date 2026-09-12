/// <reference types="vite/client" />

import type { ZenApi } from "./types/zen-api";

declare global {
  interface Window {
    zen?: ZenApi;
  }
}

declare module "*.vue" {
  import type { DefineComponent } from "vue";

  const component: DefineComponent<object, object, unknown>;
  export default component;
}

export {};
