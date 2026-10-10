import { createPinia } from "pinia";
import { createApp } from "vue";

import App from "./App.vue";
import "./assets/fonts/misans/MiSans.css";
import "./assets/fonts/fonts.css";
import "./styles.css";
import { installAppLinkInterceptor } from "./lib/open-link";

document.documentElement.classList.add("dark");

const pinia = createPinia();
createApp(App).use(pinia).mount("#app");
// 网页链接统一在右栏浏览器打开（消息、参考、设置等所有 <a href>）
installAppLinkInterceptor();
