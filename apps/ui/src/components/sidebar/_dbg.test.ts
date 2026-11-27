import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { it } from "vitest";
import { i18n } from "@/locales";
import CollapsedSessionPeek from "@/components/sidebar/CollapsedSessionPeek.vue";

it("dbg", async () => {
  setActivePinia(createPinia());
  const w = mount(CollapsedSessionPeek, { global: { plugins: [i18n] } });
  await flushPromises();
  const trigger = w.find('[data-testid="rail-session-peek-trigger"]');
  console.log("before", trigger.attributes("aria-expanded"), trigger.html().slice(0, 120));
  await trigger.trigger("click");
  await flushPromises();
  console.log("after", trigger.attributes("aria-expanded"));
  console.log("hasContent", w.find('[data-testid="rail-session-peek"]').exists());
  console.log("bodyHasContent", document.body.innerHTML.includes("rail-session-peek"));
});
