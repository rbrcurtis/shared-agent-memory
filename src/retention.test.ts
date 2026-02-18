import { describe, it, expect } from 'vitest';
import { computeRetention, computeStability, BASE_HALF_LIFE, TOMBSTONE_THRESHOLD } from './retention.js';

describe('computeStability', () => {
  it('returns 1.0 for 0 accesses', () => {
    expect(computeStability(0)).toBeCloseTo(1.0);
  });

  it('returns ~1.69 for 1 access', () => {
    expect(computeStability(1)).toBeCloseTo(1.693, 2);
  });

  it('returns ~2.79 for 5 accesses', () => {
    expect(computeStability(5)).toBeCloseTo(2.792, 2);
  });

  it('returns ~4.04 for 20 accesses', () => {
    expect(computeStability(20)).toBeCloseTo(4.045, 2);
  });
});

describe('computeRetention', () => {
  it('returns 1.0 for 0 days elapsed', () => {
    expect(computeRetention(0, 1.0)).toBeCloseTo(1.0);
  });

  it('returns 0.5 at exactly BASE_HALF_LIFE days with stability=1.0', () => {
    expect(computeRetention(BASE_HALF_LIFE, 1.0)).toBeCloseTo(0.5, 2);
  });

  it('returns 0.5 at 2x BASE_HALF_LIFE days with stability=2.0', () => {
    expect(computeRetention(BASE_HALF_LIFE * 2, 2.0)).toBeCloseTo(0.5, 2);
  });

  it('returns near 0 after very long time', () => {
    const ret = computeRetention(BASE_HALF_LIFE * 10, 1.0);
    expect(ret).toBeLessThan(TOMBSTONE_THRESHOLD);
  });

  it('returns higher retention for higher stability at same time', () => {
    const low = computeRetention(90, 1.0);
    const high = computeRetention(90, 3.0);
    expect(high).toBeGreaterThan(low);
  });
});
