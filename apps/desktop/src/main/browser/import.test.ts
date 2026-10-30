import { describe, expect, it } from "vitest";

import { parsePasswordCsv } from "./import";

describe("parsePasswordCsv", () => {
  it("跳过表头并解析 Chrome 导出格式", () => {
    const result = parsePasswordCsv(
      ["name,url,username,password,note", "GitHub,https://github.com,me@example.com,pw1,note", ""].join(
        "\n",
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.rows).toEqual([
      { name: "GitHub", url: "https://github.com", username: "me@example.com", password: "pw1" },
    ]);
    expect(result.skipped).toBe(0);
  });

  it("支持引号包裹、引号内逗号与转义引号", () => {
    const result = parsePasswordCsv(
      'name,url,username,password,note\n"站点, A",https://a.example,u1,"p""w,1",',
    );
    expect(result.ok).toBe(true);
    expect(result.rows[0]).toEqual({
      name: "站点, A",
      url: "https://a.example",
      username: "u1",
      password: 'p"w,1',
    });
  });

  it("按 Firefox 表头位置读取 URL、用户名和密码", () => {
    const result = parsePasswordCsv(
      "url,username,password,httpRealm,formActionOrigin\nhttps://mozilla.example/login,fox,secret,,https://mozilla.example",
    );
    expect(result).toEqual({
      ok: true,
      rows: [{ name: "", url: "https://mozilla.example/login", username: "fox", password: "secret" }],
      skipped: 0,
    });
  });

  it("按 Safari 表头读取密码，并保留引号中的换行和逗号", () => {
    const result = parsePasswordCsv(
      '\uFEFFTitle,URL,Username,Password,Notes\r\n"站点, A",https://safari.example,user,"line 1\nline 2, end",note',
    );
    expect(result.rows).toEqual([{
      name: "站点, A",
      url: "https://safari.example",
      username: "user",
      password: "line 1\nline 2, end",
    }]);
    expect(result.ok).toBe(true);
  });

  it("无表头按数据行解析；缺 url 或全空的用户名密码计入 skipped", () => {
    const result = parsePasswordCsv(
      ["Site,https://site.example,user,pw", ",https://no-name.example,user,pw", "X,,u,p", "Y,https://y.example,,"].join(
        "\n",
      ),
    );
    expect(result.ok).toBe(true);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]?.name).toBe("Site");
    // 名字可空（只按 url + 凭据判定有效性）
    expect(result.rows[1]).toEqual({ name: "", url: "https://no-name.example", username: "user", password: "pw" });
    expect(result.skipped).toBe(2);
  });

  it("空文件与无有效条目返回失败", () => {
    expect(parsePasswordCsv("").ok).toBe(false);
    expect(parsePasswordCsv("name,url,username,password,note").ok).toBe(false);
  });

  it("拒绝未知表头与未闭合引号，不把错位列当作密码", () => {
    expect(parsePasswordCsv("site,address,login,secret\nA,https://a.example,user,pw")).toMatchObject({
      ok: false,
      error: "无法识别密码 CSV 表头",
    });
    expect(parsePasswordCsv('name,url,username,password\nA,https://a.example,user,"unfinished')).toMatchObject({
      ok: false,
      error: "密码 CSV 引号格式不正确",
    });
    expect(parsePasswordCsv('name,url,username,password\nA,https://a.example,user,"pw"extra')).toMatchObject({
      ok: false,
      error: "密码 CSV 引号格式不正确",
    });
  });
});
