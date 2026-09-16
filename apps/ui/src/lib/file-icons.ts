import {
  File,
  FileArchive,
  FileCode,
  FileCog,
  FileImage,
  FileJson,
  FileLock,
  FileText,
  FileType,
  FileVideo,
  FileVolume,
  Music,
} from "@lucide/vue";

import type { FunctionalComponent } from "vue";

export interface FileIconSpec {
  icon: FunctionalComponent;
  cls: string;
}

const spec = (icon: FunctionalComponent, cls: string): FileIconSpec => ({ icon, cls });

const byExt: Record<string, FileIconSpec> = {
  // web / 前端
  ts: spec(FileType, "text-[#4d9fd6]"),
  mts: spec(FileType, "text-[#4d9fd6]"),
  cts: spec(FileType, "text-[#4d9fd6]"),
  vue: spec(FileCode, "text-[#42b883]"),
  js: spec(FileCode, "text-[#e8c06c]"),
  mjs: spec(FileCode, "text-[#e8c06c]"),
  cjs: spec(FileCode, "text-[#e8c06c]"),
  jsx: spec(FileCode, "text-[#5fb8e0]"),
  tsx: spec(FileType, "text-[#4d9fd6]"),
  json: spec(FileJson, "text-[#e8c06c]"),
  jsonc: spec(FileJson, "text-[#e8c06c]"),
  html: spec(FileCode, "text-[#e07a4f]"),
  css: spec(FileCode, "text-[#5a9cff]"),
  scss: spec(FileCode, "text-[#e07aa0]"),
  less: spec(FileCode, "text-[#5a9cff]"),
  // 后端 / 数据
  py: spec(FileCode, "text-[#5aa9e0]"),
  go: spec(FileCode, "text-[#5ac8c8]"),
  rs: spec(FileCode, "text-[#e0a06c]"),
  java: spec(FileCode, "text-[#e06c6c]"),
  kt: spec(FileCode, "text-[#a06ce0]"),
  php: spec(FileCode, "text-[#8a8ad0]"),
  rb: spec(FileCode, "text-[#e05c5c]"),
  sh: spec(FileCode, "text-[#8ac890]"),
  sql: spec(FileCode, "text-[#e0b06c]"),
  // 文档
  md: spec(FileText, "text-[var(--color-mut)]"),
  mdx: spec(FileText, "text-[var(--color-mut)]"),
  txt: spec(FileText, "text-[var(--color-mut)]"),
  pdf: spec(FileText, "text-[#e06c6c]"),
  yaml: spec(FileCog, "text-[#b070d0]"),
  yml: spec(FileCog, "text-[#b070d0]"),
  toml: spec(FileCog, "text-[#b070d0]"),
  xml: spec(FileCode, "text-[#b0a060]"),
  // 媒体
  png: spec(FileImage, "text-[#c878d8]"),
  jpg: spec(FileImage, "text-[#c878d8]"),
  jpeg: spec(FileImage, "text-[#c878d8]"),
  gif: spec(FileImage, "text-[#c878d8]"),
  webp: spec(FileImage, "text-[#c878d8]"),
  svg: spec(FileImage, "text-[#e8b05c]"),
  ico: spec(FileImage, "text-[#c878d8]"),
  mp4: spec(FileVideo, "text-[#d87858]"),
  mov: spec(FileVideo, "text-[#d87858]"),
  mp3: spec(Music, "text-[#d87858]"),
  wav: spec(Music, "text-[#d87858]"),
  // 其它
  zip: spec(FileArchive, "text-[#e0b06c]"),
  gz: spec(FileArchive, "text-[#e0b06c]"),
  tar: spec(FileArchive, "text-[#e0b06c]"),
  lock: spec(FileLock, "text-[var(--color-dim)]"),
  env: spec(FileCog, "text-[#8ac890]"),
};

export function fileIcon(name: string): FileIconSpec {
  if (name.startsWith(".env")) {
    return byExt.env;
  }
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return byExt[ext] ?? spec(File, "text-[var(--color-mut)]");
}
