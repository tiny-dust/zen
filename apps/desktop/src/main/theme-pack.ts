import { randomBytes } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { deflateRawSync, inflateRawSync } from "node:zlib";

import { BrowserWindow, app, ipcMain } from "electron";

import { showOpenDialogSafe, showSaveDialogSafe } from "./dialog-safe";
import { themeImageDir } from "./theme-image";

import {
  MAX_THEME_BACKGROUND_BYTES,
  MAX_THEME_PACK_BYTES,
  isValidThemeImageId,
  normalizeThemePack,
  packFromNomi,
  packToNomi,
} from "@zen/shared";

import type { CustomTheme, CustomThemePack, ThemeImagePickResult } from "@zen/shared";

/**
 * 主题包读写：兼容 nomi 的两种格式。
 * - 无图：纯 JSON（.nomitheme.json）
 * - 带图：ZIP（.nomitheme，含 theme.json 与 background.<ext>）
 * 只依赖 node:zlib 手写最小 ZIP 读写，避免为此引入新依赖；压缩包条目数、单条大小与总大小都设上限，
 * 防止 ZIP 炸弹与路径穿越（条目名必须是 theme.json 或 background.<ext>，不接受任何目录）。
 */

const MAX_ENTRIES = 4;
const MAX_JSON_BYTES = 64 * 1024;

/** CRC32（ZIP 每条目都需要）：查表实现，足够主题包这种体量 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) {
    crc = (CRC_TABLE[(crc ^ buffer[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}


interface ZipEntry {
  name: string;
  data: Buffer;
}

/** 只读 central directory + local header 的最小实现；遇到可疑结构直接失败 */
function readZip(buffer: Buffer): ZipEntry[] {
  // 找 EOCD（签名 0x06054b50），从尾部往前扫（注释最长 64KB）
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 0xffff); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new Error("not-a-zip");
  }
  const count = buffer.readUInt16LE(eocd + 10);
  if (count > MAX_ENTRIES) {
    throw new Error("too-many-entries");
  }
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("bad-central-directory");
    }
    const method = buffer.readUInt16LE(offset + 10);
    const crcField = buffer.readUInt32LE(offset + 16);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;

    // 路径穿越与目录条目一律拒绝；只认包内两个固定名字
    if (name.includes("/") || name.includes("\\") || name.includes("..")) {
      throw new Error("bad-entry-name");
    }
    const limit = name === "theme.json" ? MAX_JSON_BYTES : MAX_THEME_BACKGROUND_BYTES;
    if (uncompressedSize > limit || compressedSize > limit + 1024) {
      throw new Error("entry-too-large");
    }
    const expectedCrc = crcField;
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("bad-local-header");
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > buffer.length) {
      throw new Error("bad-entry-range");
    }
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer | null = null;
    if (method === 0) {
      data = raw;
    } else if (method === 8) {
      // 解压过程就限制输出量：不能先解出几百 MB 再判断大小
      try {
        data = inflateRawSync(raw, { maxOutputLength: limit });
      } catch {
        throw new Error("entry-too-large");
      }
    }
    if (!data) {
      throw new Error("unsupported-compression");
    }
    if (data.length > limit) {
      throw new Error("entry-too-large");
    }
    // CRC 不一致说明文件被截断/篡改：nomi 与标准工具都会校验，不能放行
    if (crc32(data) !== expectedCrc) {
      throw new Error("crc-mismatch");
    }
    entries.push({ name, data });
  }
  return entries;
}

/** 最小 ZIP 写出：store 或 deflate，无加密、无 zip64（主题包远小于 4GB） */
export function writeZip(entries: ZipEntry[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data);
    const useDeflate = compressed.length < entry.data.length;
    const payload = useDeflate ? compressed : entry.data;
    const method = useDeflate ? 8 : 0;

    const crc = crc32(entry.data);
    // DOS 时间：固定成 1980-01-01 00:00，避免不同机器导出的包因时间戳产生无意义差异
    const dosTime = 0;
    const dosDate = (1 << 5) | 1;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBytes, payload);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt16LE(dosTime, 12);
    cd.writeUInt16LE(dosDate, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(payload.length, 20);
    cd.writeUInt32LE(entry.data.length, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30);
    cd.writeUInt16LE(0, 32);
    cd.writeUInt16LE(0, 34);
    cd.writeUInt16LE(0, 36);
    cd.writeUInt32LE(0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBytes);

    offset += local.length + nameBytes.length + payload.length;
  }
  const centralBuffer = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuffer, eocd]);
}

function detectImageExt(buffer: Buffer): string | null {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }
  if (buffer.length > 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "webp";
  }
  return null;
}

/** 解析主题包字节 → 主题定义（背景图另存到 theme-images 再回填 id） */
export async function parseThemePack(
  buffer: Buffer,
): Promise<{ ok: true; pack: CustomThemePack } | { ok: false; error: string }> {
  if (buffer.length > MAX_THEME_PACK_BYTES) {
    return { ok: false, error: "pack-too-large" };
  }
  let json: string;
  let image: Buffer | null = null;
  try {
    if (buffer.subarray(0, 4).toString("binary") === "PK\u0003\u0004") {
      const entries = readZip(buffer);
      const meta = entries.find((entry) => entry.name === "theme.json");
      const bg = entries.find((entry) => entry.name.startsWith("background."));
      const unexpected = entries.find(
        (entry) => entry.name !== "theme.json" && !entry.name.startsWith("background."),
      );
      if (unexpected || !meta) {
        return { ok: false, error: "pack-structure" };
      }
      json = meta.data.toString("utf8");
      image = bg?.data ?? null;
    } else {
      json = buffer.toString("utf8");
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "pack-unreadable" };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: "pack-not-json" };
  }
  // 主题包可能是 nomi 的字段名（--cd-* token、background.image/opacity）：先映射再按 Zen 规则校验
  const isNomiBackground = (id: string) => /^background\.(png|jpe?g|webp)$/i.test(id) || isValidThemeImageId(id);
  const pack = normalizeThemePack(packFromNomi(raw), isNomiBackground);
  if (!pack) {
    return { ok: false, error: "pack-invalid" };
  }
  if (!image) {
    return { ok: true, pack: { ...pack, background: undefined } };
  }
  const ext = detectImageExt(image);
  if (!ext || image.length > MAX_THEME_BACKGROUND_BYTES) {
    return { ok: false, error: "background-invalid" };
  }
  await mkdir(themeImageDir(), { recursive: true });
  const id = `${randomBytes(12).toString("hex")}.${ext}`;
  await writeFile(join(themeImageDir(), id), image);
  return { ok: true, pack: { ...pack, background: { id, blur: pack.background?.blur ?? 0, dim: pack.background?.dim ?? 0.45 } } };
}

/** 选文件导入；返回解析好的主题定义，由渲染层存进设置 */
export async function importThemePack(
  window: BrowserWindow | null,
): Promise<{ ok: boolean; canceled?: boolean; pack?: CustomThemePack; error?: string }> {
  const picked = await showOpenDialogSafe(window, {
    properties: ["openFile"],
    filters: [
      { name: "Theme", extensions: ["json", "nomitheme"] },
    ],
  });
  if (picked.canceled || !picked.filePaths[0]) {
    return { ok: false, canceled: true };
  }
  try {
    const info = await stat(picked.filePaths[0]);
    if (!info.isFile() || info.size > MAX_THEME_PACK_BYTES) {
      return { ok: false, error: "pack-too-large" };
    }
    return await parseThemePack(await readFile(picked.filePaths[0]));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "pack-unreadable" };
  }
}

/** 导出：有背景图写 ZIP，无图写 JSON */
export async function exportThemePack(
  window: BrowserWindow | null,
  theme: CustomTheme,
): Promise<{ ok: boolean; canceled?: boolean; error?: string }> {
  const safeName = (theme.name.zh || theme.name.en || "theme").replace(/[\\/:*?"<>|]/g, "-").slice(0, 40);
  const hasBg = Boolean(theme.background);
  const target = await showSaveDialogSafe(window, {
    defaultPath: `${safeName}${hasBg ? ".nomitheme" : ".nomitheme.json"}`,
    filters: hasBg
      ? [{ name: "Zen theme", extensions: ["nomitheme"] }]
      : [{ name: "Zen theme", extensions: ["json"] }],
  });
  if (target.canceled || !target.filePath) {
    return { ok: false, canceled: true };
  }
  const base: CustomThemePack = {
    name: theme.name,
    base: theme.base,
    seeds: theme.seeds,
    ...(theme.tokens ? { tokens: theme.tokens } : {}),
    ...(theme.variants ? { variants: theme.variants } : {}),
  };
  try {
    if (theme.background) {
      const image = await readFile(join(themeImageDir(), theme.background.id));
      const ext = detectImageExt(image);
      if (!ext) {
        return { ok: false, error: "background-invalid" };
      }
      // 导出成 nomi 的字段名：token 用 --cd-*，背景用 image/opacity
      const withBg = packToNomi(
        { ...base, background: { id: "", blur: theme.background.blur, dim: theme.background.dim } },
        `background.${ext}`,
      );
      await writeFile(
        target.filePath,
        writeZip([
          { name: "theme.json", data: Buffer.from(`${JSON.stringify(withBg, null, 2)}\n`, "utf8") },
          { name: `background.${ext}`, data: image },
        ]),
      );
      return { ok: true };
    }
    await writeFile(target.filePath, `${JSON.stringify(packToNomi(base), null, 2)}\n`, "utf8");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "export-failed" };
  }
}

export function registerThemePackIpc(): void {
  ipcMain.handle("theme-pack:import", async (event) => importThemePack(BrowserWindow.fromWebContents(event.sender)));
  ipcMain.handle("theme-pack:export", async (event, theme: CustomTheme) => {
    const normalized = normalizeThemePack(theme, (id) => isValidThemeImageId(id));
    if (!normalized) {
      return { ok: false, error: "pack-invalid" };
    }
    return exportThemePack(BrowserWindow.fromWebContents(event.sender), { id: "x", ...normalized });
  });
  // theme-images 与主题包共用同一目录与校验：导出的背景 id 需要在读图时能通过白名单
  ipcMain.handle("theme-pack:exists", async () => true);
}

export type { ThemeImagePickResult };
