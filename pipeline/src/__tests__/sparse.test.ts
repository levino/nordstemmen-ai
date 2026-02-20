import { describe, expect, it } from 'vitest';
import { computeSparseVector, hashToken, tokenize } from '../sparse.ts';

describe('hashToken', () => {
  it('returns a uint32', () => {
    const h = hashToken('test');
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThanOrEqual(0xffffffff);
    expect(Number.isInteger(h)).toBe(true);
  });

  it('is deterministic', () => {
    expect(hashToken('gemeinde')).toBe(hashToken('gemeinde'));
    expect(hashToken('nordstemmen')).toBe(hashToken('nordstemmen'));
  });

  it('produces different hashes for different tokens', () => {
    expect(hashToken('gemeinde')).not.toBe(hashToken('nordstemmen'));
    expect(hashToken('haushalt')).not.toBe(hashToken('bebauungsplan'));
  });
});

describe('tokenize', () => {
  it('lowercases and splits on non-alphanumeric', () => {
    expect(tokenize('Hello World')).toEqual(['hello', 'world']);
  });

  it('removes German stopwords', () => {
    const tokens = tokenize('Der Rat der Gemeinde hat beschlossen');
    expect(tokens).not.toContain('der');
    expect(tokens).not.toContain('hat');
    expect(tokens).toContain('rat');
    expect(tokens).toContain('gemeinde');
    expect(tokens).toContain('beschlossen');
  });

  it('filters tokens shorter than 2 chars', () => {
    expect(tokenize('a b cd ef')).toEqual(['cd', 'ef']);
  });

  it('handles German umlauts', () => {
    const tokens = tokenize('Bebauungsplän Straße Öffnung');
    expect(tokens).toContain('bebauungsplän');
    expect(tokens).toContain('straße');
    expect(tokens).toContain('öffnung');
  });

  it('keeps numbers', () => {
    const tokens = tokenize('DS 101/2024');
    expect(tokens).toContain('ds');
    expect(tokens).toContain('101');
    expect(tokens).toContain('2024');
  });

  it('returns empty array for empty text', () => {
    expect(tokenize('')).toEqual([]);
  });
});

describe('computeSparseVector', () => {
  it('returns indices and values arrays of equal length', () => {
    const result = computeSparseVector('Gemeinde Nordstemmen Haushalt');
    expect(result.indices.length).toBe(result.values.length);
    expect(result.indices.length).toBeGreaterThan(0);
  });

  it('returns empty arrays for empty text', () => {
    const result = computeSparseVector('');
    expect(result).toEqual({ indices: [], values: [] });
  });

  it('returns empty arrays for stopword-only text', () => {
    const result = computeSparseVector('der die das und in von');
    expect(result).toEqual({ indices: [], values: [] });
  });

  it('uses BM25-TF saturation: single occurrence → 1/(1+1.2) ≈ 0.4545', () => {
    const result = computeSparseVector('haushalt');
    expect(result.values.length).toBe(1);
    expect(result.values[0]).toBeCloseTo(1 / (1 + 1.2), 5);
  });

  it('repeated tokens get higher weight', () => {
    const result = computeSparseVector('haushalt haushalt haushalt');
    expect(result.values.length).toBe(1);
    // tf=3: weight = 3/(3+1.2) = 0.714...
    expect(result.values[0]).toBeCloseTo(3 / (3 + 1.2), 5);
    expect(result.values[0]).toBeGreaterThan(1 / (1 + 1.2));
  });

  it('indices are uint32', () => {
    const result = computeSparseVector('Gemeinde Nordstemmen Bebauungsplan 2024');
    for (const idx of result.indices) {
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThanOrEqual(0xffffffff);
      expect(Number.isInteger(idx)).toBe(true);
    }
  });

  it('is deterministic', () => {
    const text = 'Der Bebauungsplan für die Escherder Straße wurde beschlossen.';
    const a = computeSparseVector(text);
    const b = computeSparseVector(text);
    expect(a).toEqual(b);
  });
});
