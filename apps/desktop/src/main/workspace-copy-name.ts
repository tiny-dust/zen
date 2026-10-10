/** 粘贴到同目录时的副本命名：`foo.txt` → `foo 副本.txt`、`foo 副本 2.txt` …（目录名/无扩展名同理） */

export function duplicateName(original: string, index: number): string {
  const dot = original.lastIndexOf(".");
  const base = dot > 0 ? original.slice(0, dot) : original;
  const ext = dot > 0 ? original.slice(dot) : "";
  const suffix = index <= 1 ? " 副本" : ` 副本 ${index}`;
  return `${base}${suffix}${ext}`;
}
