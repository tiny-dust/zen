import { describe, expect, it } from "vitest";

import { isPersistentCommand } from "./agent-processes";

describe("isPersistentCommand", () => {
  it("匹配常见常驻服务命令", () => {
    expect(isPersistentCommand("npm run dev")).toBe(true);
    expect(isPersistentCommand("pnpm run serve")).toBe(true);
    expect(isPersistentCommand("yarn start")).toBe(true);
    expect(isPersistentCommand("vite")).toBe(true);
    expect(isPersistentCommand("npx next dev")).toBe(true);
    expect(isPersistentCommand("nodemon server.js")).toBe(true);
    expect(isPersistentCommand("docker compose up")).toBe(true);
    expect(isPersistentCommand("tail -f /var/log/app.log")).toBe(true);
    expect(isPersistentCommand("python -m http.server 8000")).toBe(true);
    expect(isPersistentCommand("cargo watch -x run")).toBe(true);
    expect(isPersistentCommand("webpack --watch")).toBe(true);
  });

  it("过滤一次性命令", () => {
    expect(isPersistentCommand("")).toBe(false);
    expect(isPersistentCommand("ls -la")).toBe(false);
    expect(isPersistentCommand("cat package.json")).toBe(false);
    expect(isPersistentCommand("git status")).toBe(false);
    expect(isPersistentCommand("npm install")).toBe(false);
    expect(isPersistentCommand("npm test")).toBe(false);
    expect(isPersistentCommand("echo hello")).toBe(false);
    expect(isPersistentCommand("mkdir -p src")).toBe(false);
  });
});
