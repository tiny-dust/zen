import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_TRANSCRIPT_VIEW,
  followGlobal,
  parseTranscriptViewState,
  resetTranscriptViewForTests,
  setGlobalView,
  setSessionView,
  showsReasoning,
  toolsExpandedByDefault,
  useTranscriptView,
} from "./transcript-view";

beforeEach(() => {
  resetTranscriptViewForTests();
});

describe("transcript view 偏好", () => {
  it("默认档位是「显示思考」", () => {
    expect(DEFAULT_TRANSCRIPT_VIEW).toBe("thinking");
    const { view, hasOverride } = useTranscriptView(() => "s1");
    expect(view.value).toBe("thinking");
    expect(hasOverride.value).toBe(false);
  });

  it("会话覆盖优先于全局，且互不影响", () => {
    setGlobalView("normal");
    setSessionView("s1", "verbose");

    expect(useTranscriptView(() => "s1").view.value).toBe("verbose");
    expect(useTranscriptView(() => "s2").view.value).toBe("normal");
    expect(useTranscriptView(() => "s1").hasOverride.value).toBe(true);
  });

  it("跟随全局后清掉该会话覆盖", () => {
    setGlobalView("minimal");
    setSessionView("s1", "verbose");
    followGlobal("s1");

    const state = useTranscriptView(() => "s1");
    expect(state.view.value).toBe("minimal");
    expect(state.hasOverride.value).toBe(false);
  });

  it("写入 localStorage，重启后恢复", () => {
    setGlobalView("verbose");
    setSessionView("s9", "minimal");
    const raw = localStorage.getItem("zen.transcriptView.v1");
    expect(raw).toBeTruthy();
    expect(parseTranscriptViewState(raw)).toEqual({
      global: "verbose",
      sessions: { s9: "minimal" },
    });
  });

  it("损坏或非法数据回退默认，不抛错", () => {
    expect(parseTranscriptViewState("{not json")).toEqual({
      global: DEFAULT_TRANSCRIPT_VIEW,
      sessions: {},
    });
    expect(parseTranscriptViewState(JSON.stringify({ global: "nope", sessions: { a: 1, b: "verbose" } }))).toEqual({
      global: DEFAULT_TRANSCRIPT_VIEW,
      sessions: { b: "verbose" },
    });
  });

  it("档位映射：思考只在 thinking/verbose 显示，工具仅 verbose 默认展开", () => {
    expect(showsReasoning("minimal")).toBe(false);
    expect(showsReasoning("normal")).toBe(false);
    expect(showsReasoning("thinking")).toBe(true);
    expect(showsReasoning("verbose")).toBe(true);

    expect(toolsExpandedByDefault("verbose")).toBe(true);
    expect(toolsExpandedByDefault("thinking")).toBe(false);
  });
});
