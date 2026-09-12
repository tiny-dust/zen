import { onScopeDispose, ref } from "vue";

export function useMediaQuery(query: string) {
  const matches = ref(false);

  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    const media = window.matchMedia(query);
    matches.value = media.matches;
    const onChange = (event: MediaQueryListEvent) => {
      matches.value = event.matches;
    };
    media.addEventListener("change", onChange);
    onScopeDispose(() => {
      media.removeEventListener("change", onChange);
    });
  }

  return matches;
}
