/** token 缩写：166.1K / 1.0M→1M / 22.4M（小于 1K 直接显示整数；整数倍不带 .0） */
export function formatTokens(value: number): string {
  if (value < 1000) {
    return String(value);
  }
  if (value < 1_000_000) {
    return `${Math.round((value / 1000) * 10) / 10}K`;
  }
  return `${Math.round((value / 1_000_000) * 10) / 10}M`;
}
