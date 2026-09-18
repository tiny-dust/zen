#!/usr/bin/env node
/**
 * 更新源静态服务器（临时开放功能）：把 apps/desktop/release 目录暴露成
 * electron-updater 的 generic 更新源（latest-mac.yml + 安装包 + blockmap）。
 *
 * 与应用内默认更新源端口约定一致（@zen/shared DEFAULT_UPDATE_FEED_URL = 8899）。
 * 支持 Range 请求（blockmap 差量下载需要 206）。
 *
 * 用法：node scripts/updates-server.mjs [port]
 *   PORT=8899 HOST=0.0.0.0 也可用环境变量覆盖
 */
import { createServer } from "node:http";
import { createReadStream, promises as fsPromises } from "node:fs";
import { networkInterfaces } from "node:os";
import { dirname, extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PORT = 8899; // 与 DEFAULT_UPDATE_FEED_URL 保持一致
const port = Number(process.argv[2] || process.env.PORT || DEFAULT_PORT) || DEFAULT_PORT;
const host = process.env.HOST || "0.0.0.0";
const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../release");

const MIME = {
  ".yml": "text/yaml; charset=utf-8",
  ".yaml": "text/yaml; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".zip": "application/zip",
  ".dmg": "application/x-apple-diskimage",
  ".exe": "application/octet-stream",
  ".blockmap": "application/octet-stream",
  ".sig": "text/plain; charset=utf-8",
};

/** 解析单个 Range 头；不支持多段 */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) {
    return null;
  }
  let [, start, end] = match;
  if (start === "" && end === "") {
    return null;
  }
  if (start === "") {
    // 后缀范围：bytes=-N 取末尾 N 字节
    const length = Math.min(Number(end), size);
    return { start: size - length, end: size - 1 };
  }
  start = Number(start);
  end = end === "" ? size - 1 : Math.min(Number(end), size - 1);
  if (start > end || start >= size) {
    return { invalid: true };
  }
  return { start, end };
}

function sendFile(req, res, filePath, stat) {
  const size = stat.size;
  const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const rangeHeader = req.headers.range;
  const range = rangeHeader ? parseRange(rangeHeader, size) : null;

  if (range?.invalid) {
    res.writeHead(416, { "Content-Range": `bytes */${size}` });
    res.end();
    return;
  }

  const baseHeaders = {
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-cache",
  };
  if (range) {
    res.writeHead(206, {
      ...baseHeaders,
      "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      "Content-Length": range.end - range.start + 1,
    });
    createReadStream(filePath, { start: range.start, end: range.end }).pipe(res);
  } else {
    res.writeHead(200, { ...baseHeaders, "Content-Length": size });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405).end();
      return;
    }
    // 只允许 release 目录内的文件，防路径穿越
    const relative = decodeURIComponent(new URL(req.url ?? "/", `http://${req.headers.host ?? "x"}`).pathname);
    const filePath = normalize(join(rootDir, relative));
    if (!filePath.startsWith(rootDir + sep)) {
      res.writeHead(403).end();
      return;
    }
    const stat = await fsPromises.stat(filePath).catch(() => null);
    if (!stat?.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found（更新源只提供 latest-mac.yml 与安装包文件）");
      return;
    }
    sendFile(req, res, filePath, stat);
    console.log(`${new Date().toISOString()} ${req.method} ${relative}${req.headers.range ? ` (range)` : ""}`);
  } catch (error) {
    res.writeHead(500).end();
    console.error("serve error:", error);
  }
});

server.listen(port, host, () => {
  const lanIps = Object.values(networkInterfaces())
    .flat()
    .filter((item) => item?.family === "IPv4" && !item.internal)
    .map((item) => item.address);
  console.log(`更新源已启动: http://127.0.0.1:${port}（本机）`);
  for (const ip of lanIps) {
    console.log(`              http://${ip}:${port}（局域网）`);
  }
  console.log(`目录: ${rootDir}`);
});
