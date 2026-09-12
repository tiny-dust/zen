import { defineStore } from "pinia";
import { ref } from "vue";

const LEFT_MIN = 220;
const LEFT_MAX = 360;
const RIGHT_MIN = 280;
const RIGHT_MAX = 480;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const useLayoutStore = defineStore("layout", () => {
  const leftWidth = ref(260);
  const rightWidth = ref(320);

  const rightCollapsed = ref(false);
  const bottomCollapsed = ref(false);
  const sessionOpen = ref(true);
  const infoOpen = ref(false);

  function setLeftWidth(value: number) {
    leftWidth.value = clamp(value, LEFT_MIN, LEFT_MAX);
  }

  function setRightWidth(value: number) {
    rightWidth.value = clamp(value, RIGHT_MIN, RIGHT_MAX);
  }

  function toggleRight() {
    rightCollapsed.value = !rightCollapsed.value;
  }

  function toggleBottom() {
    bottomCollapsed.value = !bottomCollapsed.value;
  }

  function toggleSession() {
    sessionOpen.value = !sessionOpen.value;
  }

  function toggleInfo() {
    infoOpen.value = !infoOpen.value;
  }

  return {
    leftWidth,
    rightWidth,
    rightCollapsed,
    bottomCollapsed,
    sessionOpen,
    infoOpen,
    setLeftWidth,
    setRightWidth,
    toggleRight,
    toggleBottom,
    toggleSession,
    toggleInfo,
  };
});
