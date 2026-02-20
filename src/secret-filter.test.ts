import { describe, it, expect } from 'vitest';
import { detectSecrets, shannonEntropy } from './secret-filter.js';

describe('shannonEntropy', () => {
  it('returns 0 for empty string', () => {
    expect(shannonEntropy('')).toBe(0);
  });

  it('returns 0 for single repeated char', () => {
    expect(shannonEntropy('aaaaaaa')).toBe(0);
  });

  it('returns 1.0 for two equally distributed chars', () => {
    expect(shannonEntropy('abababab')).toBeCloseTo(1.0, 1);
  });

  it('returns high entropy for random-looking string', () => {
    expect(shannonEntropy('aB3kL9mQ2xR7')).toBeGreaterThan(3.0);
  });
});
