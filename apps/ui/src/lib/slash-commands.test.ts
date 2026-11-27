import { describe, expect, it } from "vitest";

import { SLASH_COMMANDS, findSlashCommand, matchSlashCommands, type SlashCommandDef } from "./slash-commands";

const FIXTURE: readonly SlashCommandDef[] = [
  { id: "help", name: "help", labelKey: "slash.help", descKey: "slash.helpDesc", keywords: ["说明"] },
  { id: "clear", name: "clear", labelKey: "slash.clear", descKey: "slash.clearDesc", keywords: ["new"] },
  { id: "diff", name: "diff", labelKey: "slash.diff", descKey: "slash.diffDesc", keywords: ["git"] },
];

describe("matchSlashCommands", () => {
  it("空查询返回全部，保持登记顺序", () => {
    expect(matchSlashCommands("", FIXTURE).map((item) => item.id)).toEqual(["help", "clear", "diff"]);
    expect(matchSlashCommands("   ", FIXTURE)).toHaveLength(3);
  });

  it("子序列匹配名字（/clr → clear）", () => {
    expect(matchSlashCommands("clr", FIXTURE).map((item) => item.id)).toEqual(["clear"]);
    expect(matchSlashCommands("hlp", FIXTURE).map((item) => item.id)).toEqual(["help"]);
  });

  it("关键词也参与匹配", () => {
    expect(matchSlashCommands("git", FIXTURE).map((item) => item.id)).toEqual(["diff"]);
    expect(matchSlashCommands("说明", FIXTURE).map((item) => item.id)).toEqual(["help"]);
  });

  it("顺序不符或无命中时返回空", () => {
    expect(matchSlashCommands("pehl", FIXTURE)).toHaveLength(0);
    expect(matchSlashCommands("zzz", FIXTURE)).toHaveLength(0);
  });

  it("大小写不敏感", () => {
    expect(matchSlashCommands("CLR", FIXTURE).map((item) => item.id)).toEqual(["clear"]);
  });
});

describe("SLASH_COMMANDS 登记表", () => {
  it("名字唯一，且都能按 id 取回", () => {
    const names = SLASH_COMMANDS.map((command) => command.name);
    expect(new Set(names).size).toBe(names.length);
    for (const command of SLASH_COMMANDS) {
      expect(findSlashCommand(command.id)?.name).toBe(command.name);
    }
  });

  it("每个命令都有展示文案键", () => {
    for (const command of SLASH_COMMANDS) {
      expect(command.labelKey.startsWith("slash.")).toBe(true);
      expect(command.descKey.startsWith("slash.")).toBe(true);
    }
  });
});
