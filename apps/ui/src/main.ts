import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import "./assets/fonts/misans/MiSans.css";
import "./assets/fonts/fonts.css";
import { installAppLinkInterceptor } from "./lib/open-link";
import { i18n } from "./locales";
import "./styles.css";

// 主题首帧：按本地镜像直接上 class，避免亮色用户看到深色闪烁；
// 精确主题（三档 + 跟随系统）由 settings store 加载后驱动 useAppTheme 校正。
document.documentElement.classList.toggle("dark", localStorage.getItem("zen.theme.dark") !== "0");

const pinia = createPinia();
createApp(App).use(pinia).use(i18n).mount("#app");
// 网页链接统一在右栏浏览器打开（消息、参考、设置等所有 <a href>）
installAppLinkInterceptor();
