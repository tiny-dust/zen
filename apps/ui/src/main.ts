import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import "./assets/fonts/misans/MiSans.css";
import "./assets/fonts/fonts.css";
import { cachedTheme } from "./composables/useAppTheme";
import { installErrorReporter } from "./lib/error-reporter";
import { installAppLinkInterceptor } from "./lib/open-link";
import { i18n } from "./locales";
import "./styles.css";

// 主题首帧：按本地镜像直接上 data-theme 与 dark 类，避免亮色用户看到深色闪烁；
// 精确主题（七套预设 + 跟随系统）由 settings store 加载后驱动 useAppTheme 校正。
{
  const { preset, dark } = cachedTheme();
  document.documentElement.dataset.theme = preset;
  document.documentElement.classList.toggle("dark", dark);
}

const pinia = createPinia();
const app = createApp(App);
// 运行时报错（window error / unhandledrejection / Vue errorHandler）统一上报异常中心
installErrorReporter(app);
app.use(pinia).use(i18n).mount("#app");
// 网页链接统一在右栏浏览器打开（消息、参考、设置等所有 <a href>）
installAppLinkInterceptor();
