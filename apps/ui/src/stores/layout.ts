import { defineStore } from "pinia";
import { ref } from "vue";

/** 左右侧栏同宽约束：最小 220 / 最大 480 */
const SIDE_MIN = 220;
const SIDE_MAX = 480;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const useLayoutStore = defineStore("layout", () => {
  const leftWidth = ref(260);
  const rightWidth = ref(320);

  const leftCollapsed = ref(false);
  const rightCollapsed = ref(false);
  const bottomCollapsed = ref(false);
  const sessionOpen = ref(true);
  const infoOpen = ref(false);

  function setLeftWidth(value: number) {
    leftWidth.value = clamp(value, SIDE_MIN, SIDE_MAX);
  }

  function setRightWidth(value: number) {
    rightWidth.value = clamp(value, SIDE_MIN, SIDE_MAX);
  }

  function toggleLeft() {
    leftCollapsed.value = !leftCollapsed.value;
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
    leftCollapsed,
    rightCollapsed,
    bottomCollapsed,
    sessionOpen,
    infoOpen,
    setLeftWidth,
    setRightWidth,
    toggleLeft,
    toggleRight,
    toggleBottom,
    toggleSession,
    toggleInfo,
  };
});
