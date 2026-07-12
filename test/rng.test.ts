import { describe, it, expect } from 'vitest';
import { seedRng, nextRng, randInt, shuffle } from '../src/engine/index.js';

describe('seeded rng', () => {
  it('is deterministic for the same seed', () => {
    const a = nextRng(seedRng(42));
    const b = nextRng(seedRng(42));
    expect(a.value).toBe(b.value);
    expect(a.state).toBe(b.state);
  });

  it('produces different streams for different seeds', () => {
    expect(nextRng(seedRng(1)).value).not.toBe(nextRng(seedRng(2)).value);
  });

  it('randInt stays within [0, n)', () => {
    let s = seedRng(7);
    for (let i = 0; i < 1000; i++) {
      const r = randInt(s, 13);
      expect(r.value).toBeGreaterThanOrEqual(0);
      expect(r.value).toBeLessThan(13);
      s = r.state;
    }
  });

  it('shuffle is a permutation and is deterministic', () => {
    const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const s = seedRng(99);
    const a = shuffle(s, items);
    const b = shuffle(s, items);
    expect(a.items).toEqual(b.items);
    expect([...a.items].sort((x, y) => x - y)).toEqual(items);
  });
});
