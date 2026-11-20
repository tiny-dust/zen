import { describe, expect, it } from "vitest";

import { classifySkillFiles } from "@/lib/skill-extras";

import type { SkillFileInfo } from "@zen/shared";

function file(path: string, size = 1): SkillFileInfo {
  return { path, size };
}

/** 取某分组的文件路径（分组不存在返回 null） */
function pathsOf(result: ReturnType<typeof classifySkillFiles>, kind: string): string[] | null {
  const group = result.groups.find((item) => item.kind === kind);
  return group ? group.files.map((item) => item.path) : null;
}

describe("classifySkillFiles", () => {
  it("空输入返回空结果", () => {
    expect(classifySkillFiles([])).toEqual({ groups: [], hasExtras: false, extraCount: 0 });
  });

  it("SKILL.md 不计入任何分组", () => {
    expect(classifySkillFiles([file("SKILL.md")])).toEqual({
      groups: [],
      hasExtras: false,
      extraCount: 0,
    });

    const result = classifySkillFiles([file("SKILL.md"), file("notes.md")]);
    expect(pathsOf(result, "doc")).toEqual(["notes.md"]);
  });

  it("文件名含 dashboard/stats/statistic/metrics/report 归入 dashboard", () => {
    const result = classifySkillFiles([
      file("dashboard.md"),
      file("references/stats.md"),
      file("reports/statistics.md"),
      file("metrics.md"),
      file("daily-report.md"),
    ]);
    expect(result.groups).toHaveLength(1);
    expect(pathsOf(result, "dashboard")).toEqual([
      "dashboard.md",
      "references/stats.md",
      "reports/statistics.md",
      "metrics.md",
      "daily-report.md",
    ]);
  });

  it("html/htm 归入 dashboard", () => {
    const result = classifySkillFiles([file("view/index.html"), file("chart.htm")]);
    expect(pathsOf(result, "dashboard")).toEqual(["view/index.html", "chart.htm"]);
    expect(pathsOf(result, "doc")).toBeNull();
  });

  it("json/csv 等结构化文件归入 data", () => {
    const result = classifySkillFiles([
      file("data/table.json"),
      file("data/rows.csv"),
      file("data/lines.jsonl"),
      file("data/kv.tsv"),
      file("data/config.yml"),
      file("data/config.yaml"),
      file("data/settings.toml"),
    ]);
    expect(pathsOf(result, "data")).toEqual([
      "data/table.json",
      "data/rows.csv",
      "data/lines.jsonl",
      "data/kv.tsv",
      "data/config.yml",
      "data/config.yaml",
      "data/settings.toml",
    ]);
  });

  it(".ts 归脚本，不被误判成 data", () => {
    const result = classifySkillFiles([file("scripts/run.ts"), file("data/table.json")]);
    expect(pathsOf(result, "script")).toEqual(["scripts/run.ts"]);
    expect(pathsOf(result, "data")).toEqual(["data/table.json"]);
  });

  it("js/py/sh 等脚本扩展名归入 script", () => {
    const result = classifySkillFiles([
      file("run.mjs"),
      file("run.cjs"),
      file("run.py"),
      file("run.sh"),
      file("run.bash"),
      file("run.zsh"),
      file("run.rb"),
    ]);
    expect(pathsOf(result, "script")).toHaveLength(7);
  });

  it("未知扩展名与文档类归入 doc", () => {
    const result = classifySkillFiles([
      file("README.md"),
      file("guide.markdown"),
      file("notes.txt"),
      file("assets/logo.png"),
      file("bin/tool"),
    ]);
    expect(pathsOf(result, "doc")).toEqual([
      "README.md",
      "guide.markdown",
      "notes.txt",
      "assets/logo.png",
      "bin/tool",
    ]);
    expect(result.groups).toHaveLength(1);
    expect(result.hasExtras).toBe(false);
  });

  it("分组顺序固定为 dashboard > data > script > doc，组内保持传入顺序", () => {
    const result = classifySkillFiles([
      file("notes.md"),
      file("run.sh"),
      file("table.csv"),
      file("report.md"),
      file("second.html"),
    ]);
    expect(result.groups.map((group) => group.kind)).toEqual([
      "dashboard",
      "data",
      "script",
      "doc",
    ]);
    expect(pathsOf(result, "dashboard")).toEqual(["report.md", "second.html"]);
    expect(pathsOf(result, "data")).toEqual(["table.csv"]);
    expect(pathsOf(result, "script")).toEqual(["run.sh"]);
    expect(pathsOf(result, "doc")).toEqual(["notes.md"]);
  });

  it("空分组不返回", () => {
    const result = classifySkillFiles([file("run.py"), file("notes.md")]);
    expect(result.groups.map((group) => group.kind)).toEqual(["script", "doc"]);
  });

  it("hasExtras / extraCount 只统计 dashboard 与 data", () => {
    const docsOnly = classifySkillFiles([file("notes.md"), file("run.py")]);
    expect(docsOnly.hasExtras).toBe(false);
    expect(docsOnly.extraCount).toBe(0);

    const withExtras = classifySkillFiles([
      file("SKILL.md"),
      file("report.md"),
      file("view.html"),
      file("table.csv"),
      file("run.py"),
      file("notes.md"),
    ]);
    expect(withExtras.hasExtras).toBe(true);
    expect(withExtras.extraCount).toBe(3);
  });

  it("路径与扩展名大小写不敏感", () => {
    const result = classifySkillFiles([
      file("SKILL.MD"),
      file("Report.MD"),
      file("DATA/CONFIG.JSON"),
      file("Scripts/RUN.PY"),
    ]);
    expect(pathsOf(result, "dashboard")).toEqual(["Report.MD"]);
    expect(pathsOf(result, "data")).toEqual(["DATA/CONFIG.JSON"]);
    expect(pathsOf(result, "script")).toEqual(["Scripts/RUN.PY"]);
  });
});
