import associations from "@/assets/charmed-icons/associations.json";

export interface FileIconSpec {
  id: string;
  src: string;
}

// Keep SVGs as bundled files instead of embedding the entire icon set in JavaScript.
const assets = import.meta.glob<string>("../assets/charmed-icons/icons/*.svg", {
  eager: true,
  query: "?url&no-inline",
  import: "default",
});
const icons = new Map<string, FileIconSpec>(
  Object.entries(assets).map(([path, src]) => {
    const id = path.slice(path.lastIndexOf("/") + 1, -4);
    return [id, { id, src }];
  }),
);
const namedFiles = new Map<string, string>(Object.entries(associations.fileNames));
const namedFolders = new Map<string, string>(Object.entries(associations.folderNames));
const extensions = Object.entries(associations.fileExtensions).sort(([a], [b]) => b.length - a.length);

function iconSpec(id: string): FileIconSpec {
  const icon = icons.get(id);
  if (!icon) throw new Error(`Missing Charmed icon asset: ${id}`);
  return icon;
}

function cleanFilePath(path: string): string {
  return path
    .replace(/(?::\d+(?::\d+)?(?:-\d+)?|#L\d+(?:C\d+)?(?:-L?\d+(?:C\d+)?)?)$/, "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
}

export function fileBasename(path: string): string {
  const clean = cleanFilePath(path);
  return clean.slice(clean.lastIndexOf("/") + 1) || path;
}

function matchesExtension(path: string, base: string, rule: string): boolean {
  const slash = rule.lastIndexOf("/");
  if (slash >= 0) {
    // Upstream includes directory-scoped associations such as workflows/yml.
    const directory = rule.slice(0, slash);
    if (!path.startsWith(`${directory}/`) && !path.includes(`/${directory}/`)) return false;
    rule = rule.slice(slash + 1);
  }
  return base === rule || base.endsWith(`.${rule}`);
}

/** Exact file names take precedence over the longest matching compound extension. */
export function fileIcon(path: string): FileIconSpec {
  const clean = cleanFilePath(path).toLowerCase();
  const base = clean.slice(clean.lastIndexOf("/") + 1);
  const named = namedFiles.get(base);
  if (named) return iconSpec(named);

  // Preserve Zen's config-family matching for names not enumerated upstream.
  if (base === ".env" || base.startsWith(".env.")) return iconSpec("config");
  if (base.startsWith("tsconfig.")) return iconSpec("typescript-config");
  if (base.startsWith("package-lock")) return iconSpec("npm-lock");
  if (base.startsWith("vite.config.") || base.startsWith("electron.vite.config.")) return iconSpec("vite");

  for (const [extension, id] of extensions) {
    if (matchesExtension(clean, base, extension)) return iconSpec(id);
  }
  return iconSpec(associations.defaults.file);
}

export function folderIcon(path: string, open = false): FileIconSpec {
  const named = namedFolders.get(fileBasename(path).toLowerCase());
  if (!named) return iconSpec(open ? associations.defaults.folderOpen : associations.defaults.folder);
  const expanded = `${named}_open`;
  return iconSpec(open && icons.has(expanded) ? expanded : named);
}
