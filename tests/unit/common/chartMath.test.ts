import { describe, it, expect } from 'vitest';
import { cumulative, logScale, topN, pct } from '@renderer/pages/settings/UsageStats/chartMath';

describe('chartMath', () => {
  it('cumulative = prefix sum', () => {
    expect(cumulative([1, 2, 3, 4])).toEqual([1, 3, 6, 10]);
    expect(cumulative([])).toEqual([]);
  });
  it('logScale uses log10(v+1), 0 stays 0', () => {
    expect(logScale(0)).toBe(0);
    expect(logScale(9)).toBeCloseTo(1, 5); // log10(10)=1
    expect(logScale(99)).toBeCloseTo(2, 5);
  });
  it('topN sorts desc by value and slices', () => {
    const r = topN(
      [
        { k: 'a', v: 3 },
        { k: 'b', v: 9 },
        { k: 'c', v: 1 },
      ],
      (x) => x.v,
      2
    );
    expect(r.map((x) => x.k)).toEqual(['b', 'a']);
  });
  it('pct guards divide-by-zero', () => {
    expect(pct(25, 100)).toBe(25);
    expect(pct(5, 0)).toBe(0);
  });
});
