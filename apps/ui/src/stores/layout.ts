import { defineStore } from "pinia";
import { ref } from "vue";

const LEFT_MIN = 220;
const LEFT_MAX = 360;
const RIGHT_MIN = 280;
const RIGHT_MAX = 480;
const SESSION_MIN = 240;
const SESSION_MAX = 400;
const INPUT_MIN = 200;
const INPUT_MAX = 360;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export const useLayoutStore = defineStore("layout", () => {
  const leftWidth = ref(260);
  const rightWidth = ref(320);
  const sessionWidth = ref(280);
  const inputWidth = ref(240);

  const rightCollapsed = ref(false);
  const bottomCollapsed = ref(false);
  const infoOpen = ref(false);

  function setLeftWidth(value: number) {
    leftWidth.value = clamp(value, LEFT_MIN, LEFT_MAX);
  }

  function setRightWidth(value: number) {
    rightWidth.value = clamp(value, RIGHT_MIN, RIGHT_MAX);
  }

  function setSessionWidth(value: number) {
    sessionWidth.value = clamp(value, SESSION_MIN, SESSION_MAX);
  }

  function setInputWidth(value: number) {
    inputWidth.value = clamp(value, INPUT_MIN, INPUT_MAX);
  }

  function toggleRight() {
    rightCollapsed.value = !rightCollapsed.value;
  }

  function toggleBottom() {
    bottomCollapsed.value = !bottomCollapsed.value;
  }

  function toggleInfo() {
    infoOpen.value = !infoOpen.value;
  }

  return {
    leftWidth,
    rightWidth,
    sessionWidth,
    inputWidth,
    rightCollapsed,
    bottomCollapsed,
    infoOpen,
    setLeftWidth,
    setRightWidth,
    setSessionWidth,
    setInputWidth,
    toggleRight,
    toggleBottom,
    toggleInfo,
  };
});
