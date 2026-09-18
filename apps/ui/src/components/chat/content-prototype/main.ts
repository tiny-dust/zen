// Isolated design review entry. This does not bootstrap the application or its IPC bridge.
import { createPinia } from "pinia";
import { createApp } from "vue";

import ContentPrototype from "./ContentPrototype.vue";
import "../../../styles.css";

if (import.meta.env.DEV) {
  createApp(ContentPrototype).use(createPinia()).mount("#app");
}
