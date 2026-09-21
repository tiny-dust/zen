import { describe, expect, it } from "vitest";

import { ansiToSpans, hasAnsi, stripAnsi } from "./ansi";

const ESC = String.fromCharCode(27);

describe("ansiToSpans", () => {
  it("无转义时返回单段纯文本", () => {
    expect(ansiToSpans("plain output")).toEqual([{ text: "plain output" }]);
  });

  it("解析前景色并在 reset 后回归默认", () => {
    const spans = ansiToSpans(`${ESC}[31mred${ESC}[0m plain`);
    expect(spans).toEqual([
      { text: "red", style: "color:#cc0000" },
      { text: " plain" },
    ]);
  });

  it("粗体等修饰输出 class", () => {
    const spans = ansiToSpans(`${ESC}[1;4mbold underline${ESC}[22;24m off`);
    expect(spans[0]?.cls).toBe("ansi-b ansi-u");
    expect(spans[1]?.text).toBe(" off");
    expect(spans[1]?.cls).toBeUndefined();
  });

  it("连续同样式文本合并为一段", () => {
    const spans = ansiToSpans(`${ESC}[32mgreen one ${ESC}[32mgreen two`);
    expect(spans).toHaveLength(1);
    expect(spans[0]?.text).toBe("green one green two");
  });

  it("支持 256 色与真彩色", () => {
    const [cube] = ansiToSpans(`${ESC}[38;5;208mabc`);
    expect(cube?.style).toBe("color:#ff8700");
    const [truecolor] = ansiToSpans(`${ESC}[38;2;12;34;56mxyz`);
    expect(truecolor?.style).toBe("color:rgb(12,34,56)");
  });

  it("反显互换前景与背景", () => {
    const spans = ansiToSpans(`${ESC}[41;37;7mcell${ESC}[0m`);
    expect(spans[0]?.style).toBe("background:#d3d7cf;color:#cc0000");
  });

  it("剥除光标移动等非颜色序列与孤立 CR", () => {
    const spans = ansiToSpans(`a${ESC}[2Kb${ESC}[1Cc\r\nnext\rframe`);
    expect(spans[0]?.text).toBe("abc\nnextframe");
  });

  it("剥除 OSC 标题序列", () => {
    const spans = ansiToSpans(`${ESC}]0;window title${ESC}\\tail`);
    expect(spans[0]?.text).toBe("tail");
  });
});

describe("hasAnsi / stripAnsi", () => {
  it("hasAnsi 识别转义", () => {
    expect(hasAnsi(`${ESC}[32mg`)).toBe(true);
    expect(hasAnsi("plain")).toBe(false);
  });

  it("stripAnsi 得到纯文本", () => {
    expect(stripAnsi(`${ESC}[1m${ESC}[32mok${ESC}[0m`)).toBe("ok");
  });
});
