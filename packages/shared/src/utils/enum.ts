/** 轻量 enumOf：主进程可 CJS 加载，不依赖仅 ESM 的 rattail */
export function enumOf<
  T extends Record<string, { value: unknown; label?: string } | unknown>,
>(map: T) {
  const keys = Object.keys(map);
  return {
    keys: () => [...keys] as Array<keyof T & string>,
    has: (key: string) => key in map,
    options: () =>
      keys.map((key) => {
        const entry = map[key];
        if (
          entry &&
          typeof entry === "object" &&
          "value" in (entry as object)
        ) {
          return entry as { value: unknown; label?: string };
        }
        return { value: entry, label: key } as { value: unknown; label?: string };
      }),
    values: () =>
      keys.map((key) => {
        const entry = map[key];
        if (
          entry &&
          typeof entry === "object" &&
          "value" in (entry as object)
        ) {
          return (entry as { value: unknown }).value;
        }
        return entry;
      }),
  };
}
