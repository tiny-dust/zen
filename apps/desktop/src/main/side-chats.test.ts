import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createSideChat,
  getSideChat,
  listSideChats,
  removeSideChat,
  setSideChatModel,
  writeSideChat,
} from "./side-chats";

// 每个用例一个临时库文件（不碰 ~/.zen/db/zen.sqlite），路径即生产形态
let dbPath: string;
let conn: Database.Database;

vi.mock("./model-db-connection", () => ({
  getDb: () => conn,
}));

beforeEach(() => {
  const dir = mkdtempSync(join(tmpdir(), "zen-side-chats-"));
  dbPath = join(dir, "zen.sqlite");
  conn = new Database(dbPath);
});

afterEach(() => {
  conn.close();
  rmSync(join(dbPath, ".."), { recursive: true, force: true });
});

describe("side-chats 存取", () => {
  it("create 的 seq 按主会话递增，标题跟着 seq，另一会话独立计数", () => {
    const first = createSideChat("s1", "common", 1000);
    const second = createSideChat("s1", "common", 1000);
    const other = createSideChat("s2", "common", 1000);

    expect([first.seq, second.seq, other.seq]).toEqual([1, 2, 1]);
    expect([first.title, second.title, other.title]).toEqual([
      "侧边对话 1",
      "侧边对话 2",
      "侧边对话 1",
    ]);
    expect(first.messages).toEqual([]);
    expect(first.draft).toBe("");
    expect(first.model).toBeNull();
    expect(first.effort).toBeNull();
    expect(first.workspaceId).toBe("common");
    expect(first.createdAt).toBe(1000);
  });

  it("list 按 session 过滤并按 seq 升序", () => {
    const a = createSideChat("s1", "common");
    const b = createSideChat("s1", "common");
    createSideChat("s2", "common");

    expect(listSideChats("s1").map((item) => item.id)).toEqual([a.id, b.id]);
    expect(listSideChats("s2")).toHaveLength(1);
    expect(listSideChats("s3")).toEqual([]);
  });

  it("writeSideChat 覆盖写消息/草稿/模型，保留标题与 seq；不存在的 id 不写入", () => {
    const created = createSideChat("s1", "common", 1000);
    const ok = writeSideChat({
      ...created,
      messages: [
        { id: "m1", role: "user", text: "你好", at: 1100 },
        { id: "m2", role: "assistant", text: "在", at: 1200 },
      ],
      draft: "半句草稿",
      model: { providerId: "openai", modelId: "gpt-5" },
      effort: "high",
      updatedAt: 2000,
    });
    expect(ok).toBe(true);

    const loaded = getSideChat(created.id);
    expect(loaded).toMatchObject({
      title: "侧边对话 1",
      seq: 1,
      draft: "半句草稿",
      model: { providerId: "openai", modelId: "gpt-5" },
      effort: "high",
      updatedAt: 2000,
    });
    expect(loaded?.messages.map((item) => item.text)).toEqual(["你好", "在"]);

    expect(writeSideChat({ ...created, id: "not-exist" })).toBe(false);
    expect(getSideChat("not-exist")).toBeUndefined();
  });

  it("库里的坏 JSON 容错：messages → []，model → null，不抛到调用方", () => {
    const created = createSideChat("s1", "common");
    conn
      .prepare("UPDATE side_chats SET messages = ?, model = ? WHERE id = ?")
      .run("{坏 JSON", "[1,2,3]", created.id);

    const loaded = getSideChat(created.id);
    expect(loaded?.messages).toEqual([]);
    expect(loaded?.model).toBeNull();
    expect(listSideChats("s1")[0]?.messages).toEqual([]);
  });

  it("messages 里的非法单条被丢弃，合法条目保留", () => {
    const created = createSideChat("s1", "common");
    conn
      .prepare("UPDATE side_chats SET messages = ? WHERE id = ?")
      .run(
        JSON.stringify([
          { id: "ok-1", role: "user", text: "保留", at: 1 },
          { role: "system", text: "非法角色" },
          { id: "no-text", role: "assistant" },
          "not-an-object",
          { role: "assistant", text: "也保留", error: "上次失败" },
        ]),
        created.id,
      );

    const loaded = getSideChat(created.id);
    expect(loaded?.messages.map((item) => item.text)).toEqual(["保留", "也保留"]);
    expect(loaded?.messages[1]?.error).toBe("上次失败");
  });

  it("setSideChatModel 更新模型与 effort；removeSideChat 删除记录", () => {
    const created = createSideChat("s1", "common");
    expect(setSideChatModel(created.id, { providerId: "p", modelId: "m" }, "low", 3000)).toBe(true);
    expect(getSideChat(created.id)).toMatchObject({
      model: { providerId: "p", modelId: "m" },
      effort: "low",
      updatedAt: 3000,
    });
    expect(setSideChatModel(created.id, null, null, 4000)).toBe(true);
    expect(getSideChat(created.id)?.model).toBeNull();
    expect(setSideChatModel("not-exist", null, null)).toBe(false);

    expect(removeSideChat(created.id)).toBe(true);
    expect(getSideChat(created.id)).toBeUndefined();
    expect(removeSideChat(created.id)).toBe(false);
  });

  it("重启（重开同一库文件）后记录仍在，可按 session 继续取回", () => {
    const created = createSideChat("s1", "workspace-1");
    writeSideChat({
      ...created,
      messages: [{ id: "m1", role: "user", text: "记一下", at: 10 }],
      draft: "还没发",
      updatedAt: 20,
    });

    conn.close();
    conn = new Database(dbPath);

    const reopened = listSideChats("s1");
    expect(reopened).toHaveLength(1);
    expect(reopened[0]).toMatchObject({ id: created.id, workspaceId: "workspace-1", draft: "还没发" });
    expect(reopened[0]?.messages.map((item) => item.text)).toEqual(["记一下"]);
  });
});
