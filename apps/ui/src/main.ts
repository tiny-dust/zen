import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import "./assets/fonts/misans/MiSans.css";
import "./assets/fonts/fonts.css";
import "./styles.css";
import { initTheme } from "./composables/useTheme";
import { installAppLinkInterceptor } from "./lib/open-link";

// 首帧前落主题：data-theme + .dark 同步就位，避免挂载后闪变
initTheme();

const pinia = createPinia();
createApp(App).use(pinia).mount("#app");
// 网页链接统一在右栏浏览器打开（消息、参考、设置等所有 <a href>）
installAppLinkInterceptor();
