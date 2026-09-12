import { readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";

import { isEmpty, slash } from "rattail";

export interface ReadFileResult {
  path: string;
  content: string;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function resolveWorkspacePath(workspaceRoot: string, relativePath: string): string {
  if (isEmpty(relativePath)) {
    throw new Error("path is required");
  }
  if (isAbsolute(relativePath)) {
    throw new Error(`absolute path is not allowed: ${relativePath}`);
  }
  const root = slash(normalize(workspaceRoot));
  const full = slash(normalize(join(workspaceRoot, relativePath)));
  if (full !== root && !full.startsWith(`${root}/`)) {
    throw new Error(`path escapes workspace: ${relativePath}`);
  }
  return full;
}

export async function readWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
): Promise<ReadFileResult> {
  const fullPath = resolveWorkspacePath(workspaceRoot, relativePath);
  try {
    const content = await readFile(fullPath, "utf8");
    return { path: relativePath, content };
  } catch (error) {
    throw new Error(`failed to read ${relativePath}: ${toErrorMessage(error)}`);
  }
}

export async function writeWorkspaceFile(
  workspaceRoot: string,
  relativePath: string,
  content: string,
): Promise<ReadFileResult> {
  const fullPath = resolveWorkspacePath(workspaceRoot, relativePath);
  try {
    await writeFile(fullPath, content, "utf8");
    return { path: relativePath, content };
  } catch (error) {
    throw new Error(`failed to write ${relativePath}: ${toErrorMessage(error)}`);
  }
}
