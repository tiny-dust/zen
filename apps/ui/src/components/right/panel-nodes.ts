import type { GitFileChange } from "@zen/shared";

export interface FileTreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: FileTreeNode[];
}

export interface ChangeNode {
  name: string;
  path: string;
  isDir: boolean;
  change?: GitFileChange;
  children: ChangeNode[];
}
