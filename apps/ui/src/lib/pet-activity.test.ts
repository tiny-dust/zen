import { describe, expect, it } from "vitest";

import { buildPetActivity } from "@/lib/pet-activity";

describe("buildPetActivity", () => {
  it("hides unresolvable old results without affecting current sessions", () => {
    const statuses = {
      oldError: "error", oldDone1: "done", oldDone2: "done", oldDone3: "done",
      finished: "done", running: "running",
    } as const;
    const titles = new Map([["finished", "刚完成的会话"], ["running", "正在进行的会话"]]);
    const unseen = (id: string) => id !== "running";

    expect(buildPetActivity(statuses, titles, unseen)).toEqual({
      status: "done",
      sessions: [
        { id: "finished", name: "刚完成的会话", status: "done" },
        { id: "running", name: "正在进行的会话", status: "running" },
      ],
    });
    titles.set("oldError", "重新找到的会话");
    expect(buildPetActivity(statuses, titles, unseen).sessions[0]).toEqual({
      id: "oldError", name: "重新找到的会话", status: "error",
    });
  });

  it("keeps a live run visible before its workspace title loads", () => {
    expect(buildPetActivity({ live: "running" }, new Map(), () => false)).toEqual({
      status: "working", sessions: [{ id: "live", name: "会话", status: "running" }],
    });
  });
});
