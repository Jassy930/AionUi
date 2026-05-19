/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/** 前缀和（分时序列 → 累计序列）。 */
export function cumulative(xs: number[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const x of xs) {
    acc += x;
    out.push(acc);
  }
  return out;
}

/** 对数坐标变换；log10(v+1)，0 保持 0，避免负无穷。 */
export function logScale(v: number): number {
  return v <= 0 ? 0 : Math.log10(v + 1);
}

/** 按 value 降序取前 n。 */
export function topN<T>(items: T[], value: (t: T) => number, n: number): T[] {
  return [...items].toSorted((a, b) => value(b) - value(a)).slice(0, n);
}

/** 占比百分比，分母 0 返回 0。 */
export function pct(part: number, total: number): number {
  return total <= 0 ? 0 : (part / total) * 100;
}

/** 统一 token 数字格式：K/M/B 两位小数，绝对值 < 1000 显示原数字。全界面复用。 */
export function formatTokens(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return String(n);
}
