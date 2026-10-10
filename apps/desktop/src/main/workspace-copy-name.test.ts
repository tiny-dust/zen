import { describe, expect, it } from "vitest";

import { duplicateName } from "./workspace-copy-name";

describe("duplicateName", () => {
  it("带扩展名文件：副本序号插在扩展名前", () => {
    expect(duplicateName("foo.txt", 1)).toBe("foo 副本.txt");
    expect(duplicateName("foo.txt", 2)).toBe("foo 副本 2.txt");
    expect(duplicateName("foo.tar.gz", 3)).toBe("foo.tar 副本 3.gz");
  });

  it("目录与无扩展名文件：副本追加在名字末尾", () => {
    expect(duplicateName("src", 1)).toBe("src 副本");
    expect(duplicateName("src", 4)).toBe("src 副本 4");
  });

  it("点开头的隐藏文件不视为有扩展名", () => {
    expect(duplicateName(".gitignore", 1)).toBe(".gitignore 副本");
  });
});
