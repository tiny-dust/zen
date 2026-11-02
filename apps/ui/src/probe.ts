import { createPinia } from "pinia";
import { createApp, h } from "vue";

import BrowserImportDialog from "@/components/right/BrowserImportDialog.vue";
import { i18n } from "@/locales";

import "./styles.css";

document.documentElement.classList.add("dark");

const passwords = [
  { id: "1", origin: "https://github.com", title: "github.com", username: "shunshun.zhou@2iot.com" },
  { id: "2", origin: "http://localhost:10002", title: "localhost", username: "admin" },
  { id: "3", origin: "https://vvbin.cn", title: "vvbin.cn", username: "https://vvbin.cn" },
  { id: "4", origin: "https://passport.bilibili.com", title: "passport.bilibili.com", username: "17625022511" },
];

const status = {
  state: "idle",
  url: "https://github.com/x/y",
  title: "",
  canGoBack: false,
  canGoForward: false,
  loading: false,
  pip: false,
  pipHidden: false,
  picking: false,
  error: "",
};

const noop = async () => undefined;

(globalThis as unknown as { zen: unknown }).zen = {
  browser: new Proxy(
    {
      status: async () => status,
      getSettings: async () => ({ autoFillPasswords: true }),
      listPasswords: async () => passwords,
      importSources: async () => [
        { id: "chrome", name: "Google Chrome", bookmarks: true, history: true, passwords: true },
        { id: "edge", name: "Microsoft Edge", bookmarks: true, history: true, passwords: true },
        { id: "safari", name: "Safari", bookmarks: true, history: true, passwords: false },
      ],
      beginOverlay: noop,
      endOverlay: noop,
      ensureRunning: async () => status,
    },
    {
      get(target: Record<string, unknown>, prop: string) {
        if (prop in target) {
          return target[prop];
        }
        return noop;
      },
    },
  ),
  app: { info: async () => ({ workspaceRoot: "" }) },
};

import { useBrowserStore } from "@/stores/browser";

const pinia = createPinia();
createApp({
  render: () => h(BrowserImportDialog, { open: true, "onUpdate:open": () => undefined }),
})
  .use(pinia)
  .use(i18n)
  .mount("#app");

// 让弹窗拿到与真实应用同样的密码列表与设置（否则只渲染空态，复现不到溢出）
const store = useBrowserStore(pinia);
void store.loadPasswords();
void store.loadBrowserSettingsState();
