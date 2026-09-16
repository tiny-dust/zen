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
  Folder,
  FolderArchive,
  FolderCode,
  FolderCog,
  FolderGit,
  FolderGit2,
  FolderHeart,
  FolderKanban,
  FolderOpen,
  FolderRoot,
  Music,
  Package,
  Settings,
  Shield,
} from "@lucide/vue";

import type { FunctionalComponent } from "vue";

export interface FileIconSpec {
  icon: FunctionalComponent;
  cls: string;
}

const spec = (icon: FunctionalComponent, cls: string): FileIconSpec => ({ icon, cls });

/** 文件名（不含路径）精确匹配 —— 优先于扩展名 */
const byName: Record<string, FileIconSpec> = {
  "package.json": spec(Package, "text-[#e05c5c]"),
  "package-lock.json": spec(Package, "text-[#e05c5c]"),
  "pnpm-lock.yaml": spec(Package, "text-[#e0a06c]"),
  "pnpm-workspace.yaml": spec(Package, "text-[#e0a06c]"),
  "yarn.lock": spec(Package, "text-[#5ac8c8]"),
  "tsconfig.json": spec(FileType, "text-[#4d9fd6]"),
  "tsconfig.base.json": spec(FileType, "text-[#4d9fd6]"),
  "jsconfig.json": spec(FileType, "text-[#e8c06c]"),
  "components.json": spec(FileJson, "text-[#5a9cff]"),
  "vite.config.ts": spec(FileCode, "text-[#b070d0]"),
  "vite.config.js": spec(FileCode, "text-[#b070d0]"),
  "electron.vite.config.ts": spec(FileCode, "text-[#b070d0]"),
  "webpack.config.js": spec(FileCode, "text-[#5fb8e0]"),
  "next.config.js": spec(FileCode, "text-[#d0d0d0]"),
  "nuxt.config.ts": spec(FileCode, "text-[#00dc82]"),
  "tailwind.config.js": spec(FileCode, "text-[#38bdf8]"),
  "tailwind.config.ts": spec(FileCode, "text-[#38bdf8]"),
  ".gitignore": spec(FolderGit, "text-[#e07a4f]"),
  ".gitattributes": spec(FolderGit, "text-[#e07a4f]"),
  ".npmrc": spec(Package, "text-[#e05c5c]"),
  ".nvmrc": spec(FileCog, "text-[#8ac890]"),
  ".editorconfig": spec(Settings, "text-[var(--color-mut)]"),
  ".prettierrc": spec(FileCog, "text-[#c878d8]"),
  ".eslintrc": spec(FileCog, "text-[#5a9cff]"),
  "eslint.config.js": spec(FileCog, "text-[#5a9cff]"),
  "eslint.config.mjs": spec(FileCog, "text-[#5a9cff]"),
  "README.md": spec(FileText, "text-[#4d9fd6]"),
  "AGENTS.md": spec(FileText, "text-[#e0a06c]"),
  "CLAUDE.md": spec(FileText, "text-[#e0a06c]"),
  "LICENSE": spec(Shield, "text-[#e8c06c]"),
  "Dockerfile": spec(FileCode, "text-[#5fb8e0]"),
  "docker-compose.yml": spec(FileCode, "text-[#5fb8e0]"),
  "docker-compose.yaml": spec(FileCode, "text-[#5fb8e0]"),
  Makefile: spec(FileCog, "text-[#8ac890]"),
};

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
  htm: spec(FileCode, "text-[#e07a4f]"),
  css: spec(FileCode, "text-[#5a9cff]"),
  scss: spec(FileCode, "text-[#e07aa0]"),
  sass: spec(FileCode, "text-[#e07aa0]"),
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
  bash: spec(FileCode, "text-[#8ac890]"),
  zsh: spec(FileCode, "text-[#8ac890]"),
  sql: spec(FileCode, "text-[#e0b06c]"),
  // 文档
  md: spec(FileText, "text-[#5a9cff]"),
  mdx: spec(FileText, "text-[#5a9cff]"),
  txt: spec(FileText, "text-[var(--color-mut)]"),
  pdf: spec(FileText, "text-[#e06c6c]"),
  yaml: spec(FileCog, "text-[#b070d0]"),
  yml: spec(FileCog, "text-[#b070d0]"),
  toml: spec(FileCog, "text-[#b070d0]"),
  xml: spec(FileCode, "text-[#b0a060]"),
  csv: spec(FileText, "text-[#8ac890]"),
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

/** 目录名 → 目录图标（对齐 Material / VS Code 文件树风格） */
const folderByName: Record<string, FileIconSpec> = {
  src: spec(FolderCode, "text-[#5a9cff]"),
  components: spec(FolderCode, "text-[#42b883]"),
  public: spec(FileImage, "text-[#e0a06c]"),
  assets: spec(FileImage, "text-[#c878d8]"),
  docs: spec(FolderHeart, "text-[#5a9cff]"),
  packages: spec(FolderKanban, "text-[#e0b06c]"),
  apps: spec(FolderRoot, "text-[#5fb8e0]"),
  desktop: spec(FolderCog, "text-[#b070d0]"),
  ui: spec(FolderCode, "text-[#42b883]"),
  scripts: spec(FolderCog, "text-[#8ac890]"),
  config: spec(FolderCog, "text-[#b070d0]"),
  ".git": spec(FolderGit2, "text-[#e07a4f]"),
  ".github": spec(FolderGit, "text-[#e07a4f]"),
  artifacts: spec(FolderArchive, "text-[#e0b06c]"),
  research: spec(Folder, "text-[#5ac8c8]"),
  resources: spec(Folder, "text-[#e8b05c]"),
  node_modules: spec(Folder, "text-[var(--color-dim)]"),
};

export function fileIcon(name: string): FileIconSpec {
  const base = name.includes("/") ? name.slice(name.lastIndexOf("/") + 1) : name;
  if (base.startsWith(".env")) {
    return byExt.env;
  }
  const named = byName[base];
  if (named) {
    return named;
  }
  // package-lock / tsconfig.* 等前缀
  if (base.startsWith("tsconfig.")) {
    return byName["tsconfig.json"];
  }
  if (base.startsWith("package-lock")) {
    return byName["package.json"];
  }
  if (base.startsWith("vite.config")) {
    return byName["vite.config.ts"];
  }
  const ext = base.includes(".") ? base.slice(base.lastIndexOf(".") + 1).toLowerCase() : "";
  return byExt[ext] ?? spec(File, "text-[var(--color-mut)]");
}

/** 目录图标：按文件夹名着色，展开/收起用 open 状态 */
export function folderIcon(name: string, open = false): FileIconSpec {
  const named = folderByName[name];
  if (named) {
    return named;
  }
  return spec(open ? FolderOpen : Folder, "text-[#e8c06c]");
}
