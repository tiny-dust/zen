import { describe, expect, it } from "vitest";

import associations from "@/assets/charmed-icons/associations.json";
import { fileBasename, fileIcon, folderIcon } from "./file-icons";

describe("file icons", () => {
  it.each([
    ["src/main.ts:12:4", "main.ts"],
    ["C:\\work\\src\\main.ts:12", "main.ts"],
    ["src/main.ts#L12-L15", "main.ts"],
    ["src/main.ts#L12C4", "main.ts"],
    ["C:\\work\\src\\", "src"],
    ["/", "/"],
    ["", ""],
  ])("extracts basename from %s", (path, name) => {
    expect(fileBasename(path)).toBe(name);
  });

  it("uses Charmed SVG assets with file names taking precedence", () => {
    expect(fileIcon("C:\\repo\\package.json:2")).toMatchObject({ id: "node" });
    expect(fileIcon("src/main.ts:2:3")).toEqual(fileIcon("main.ts"));
    expect(fileIcon("image.PNG")).toEqual(fileIcon("image.png"));
    expect(fileIcon(".env.local")).toMatchObject({ id: "config" });
    expect(fileIcon("unknown.extension")).toMatchObject({ id: "_file" });
    expect(fileIcon("main.ts").src).toMatch(/charmed-icons\/icons\/typescript\.svg/);
    expect(fileIcon("main.ts").src).not.toBe(fileIcon("main.js").src);
  });

  it("supports compound extensions and directory-scoped associations", () => {
    expect(fileIcon("types.ts")).toMatchObject({ id: "typescript" });
    expect(fileIcon("types.d.ts")).toMatchObject({ id: "typescript-def" });
    expect(fileIcon("src/foo.test.ts")).toMatchObject({ id: "test-blue" });
    expect(fileIcon("src/foo.stories.vue")).toMatchObject({ id: "storybook" });
    expect(fileIcon(".github/workflows/build.yml")).toMatchObject({ id: "workflow" });
    expect(fileIcon("config/build.yml")).not.toMatchObject({ id: "workflow" });
  });

  it("preserves config-family matching and ignores object prototype names", () => {
    expect(fileIcon(".env.custom").id).toBe("config");
    expect(fileIcon("tsconfig.custom.json").id).toBe("typescript-config");
    expect(fileIcon("electron.vite.config.ts").id).toBe("vite");
    expect(fileIcon("package-lock.backup").id).toBe("npm-lock");
    expect(fileIcon("constructor").id).toBe("_file");
    expect(folderIcon("__proto__").id).toBe("_folder");
    expect(fileIcon("src/a.ts:12-15").id).toBe("typescript");
    expect(fileIcon("README.MD").id).toBe("readme");
    expect(fileIcon("C:\\repo\\.vscode\\settings.json#L4").id).toBe("vscode");
  });

  it("has a local SVG for every upstream mapping and expanded folder", () => {
    const resources = import.meta.glob<string>("../assets/charmed-icons/icons/*.svg", { query: "?raw", import: "default", eager: true });
    const ids = new Set(Object.keys(resources).map((path) => path.slice(path.lastIndexOf("/") + 1, -4)));
    const mappedIds = [
      ...Object.values(associations.defaults), ...Object.values(associations.fileNames),
      ...Object.values(associations.fileExtensions), ...Object.values(associations.folderNames),
      ...Object.values(associations.folderNames).map((id) => `${id}_open`),
    ];
    expect(ids.size).toBe(249);
    expect(mappedIds.filter((id) => !ids.has(id))).toEqual([]);
    for (const svg of Object.values(resources)) {
      expect(svg).not.toMatch(/<script\b|<foreignObject\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?:https?:|javascript:|\/\/)/i);
    }
  });

  it("resolves directory basenames and open state", () => {
    expect(folderIcon("C:\\work\\src\\")).toEqual(folderIcon("src"));
    expect(folderIcon("src")).toMatchObject({ id: "folder_source" });
    expect(folderIcon("src", true)).toMatchObject({ id: "folder_source_open" });
    expect(folderIcon("custom")).toMatchObject({ id: "_folder" });
    expect(folderIcon("custom", true)).toMatchObject({ id: "_folder_open" });
  });
});
