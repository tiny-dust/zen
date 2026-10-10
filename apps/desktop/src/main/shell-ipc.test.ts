import { describe, expect, it, vi } from "vitest";

// shell-ipc.ts 顶层 import electron，单测只验证纯 JS 的 ICNS 解析，mock 掉即可
vi.mock("electron", () => ({
  app: { getFileIcon: vi.fn() },
  ipcMain: { handle: vi.fn() },
  nativeImage: { createFromBuffer: vi.fn(), createFromPath: vi.fn() },
  shell: { openPath: vi.fn(), showItemInFolder: vi.fn() },
}));

import { extractIcnsPng } from "./shell-ipc";

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngAtomPayload(tag: string): Buffer {
  return Buffer.concat([PNG_MAGIC, Buffer.from(tag, "ascii")]);
}

function icnsAtom(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(type, 0, 4, "ascii");
  head.writeUInt32BE(8 + data.length, 4);
  return Buffer.concat([head, data]);
}

function icnsContainer(...atoms: Buffer[]): Buffer {
  const total = 8 + atoms.reduce((sum, atom) => sum + atom.length, 0);
  const head = Buffer.alloc(8);
  head.write("icns", 0, 4, "ascii");
  head.writeUInt32BE(total, 4);
  return Buffer.concat([head, ...atoms]);
}

describe("extractIcnsPng", () => {
  it("跳过非 PNG atom，返回 PNG atom 数据", () => {
    const png = pngAtomPayload("512");
    const icns = icnsContainer(
      icnsAtom("ic10", Buffer.from("old-jpeg-data", "ascii")), // 非 PNG
      icnsAtom("ic09", png),
    );
    expect(extractIcnsPng(icns)).toEqual(png);
  });

  it("多个 PNG atom 时按尺寸偏好取最大（ic10 > ic08）", () => {
    const big = pngAtomPayload("1024");
    const small = pngAtomPayload("256");
    const icns = icnsContainer(
      icnsAtom("ic08", small),
      icnsAtom("ic10", big),
    );
    expect(extractIcnsPng(icns)).toEqual(big);
  });

  it("老格式 icns（无 PNG atom）返回 undefined", () => {
    const icns = icnsContainer(
      icnsAtom("is32", Buffer.from([0x00, 0x01, 0x02, 0x03])),
      icnsAtom("s8mk", Buffer.from([0xff, 0xfe, 0xfd])),
    );
    expect(extractIcnsPng(icns)).toBeUndefined();
  });

  it("非 icns 输入返回 undefined", () => {
    expect(extractIcnsPng(PNG_MAGIC)).toBeUndefined();
    expect(extractIcnsPng(Buffer.alloc(0))).toBeUndefined();
  });

  it("atom 长度越界时用已收集的有效 atom 兜底", () => {
    const png = pngAtomPayload("256");
    const icns = icnsContainer(icnsAtom("ic08", png));
    // 追加一个长度声明超出文件末尾的损坏 atom
    const broken = Buffer.alloc(8);
    broken.write("ic09", 0, 4, "ascii");
    broken.writeUInt32BE(0xffffff, 4);
    expect(extractIcnsPng(Buffer.concat([icns, broken]))).toEqual(png);
  });
});
