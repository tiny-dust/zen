import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: class {}, screen: {} }));

import { petFrameSource } from "./pet-window";

describe("petFrameSource", () => {
  it("maps each status to its own row of four 256px frames", () => {
    for (const [status, row] of [
      ["idle", 0],
      ["working", 1],
      ["done", 2],
      ["error", 3],
    ] as const) {
      for (let frame = 0; frame < 4; frame++) {
        expect(petFrameSource(status, frame)).toEqual({ x: frame * 256, y: row * 256, size: 256 });
      }
    }
  });

  it("loops to the first frame after the fourth", () => {
    expect(petFrameSource("working", 4)).toEqual(petFrameSource("working", 0));
    expect(petFrameSource("error", 7)).toEqual(petFrameSource("error", 3));
  });
});
