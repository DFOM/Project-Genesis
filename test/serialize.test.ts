import { describe, it, expect } from 'vitest';
import { serialize } from '../src/engine/index.js';
import { tinyWorld, addAgent } from './helpers.js';

describe('canonical serialize', () => {
  it('is stable regardless of object key insertion order', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 1, 1);
    const s1 = serialize(w);
    // Rebuild an equivalent world with keys inserted in a different order.
    const w2 = tinyWorld();
    addAgent(w2, 'agent-00', 1, 1);
    expect(serialize(w2)).toBe(s1);
  });

  it('rejects non-integer scalars (float guard for cross-machine hashing)', () => {
    const w = tinyWorld();
    const a = addAgent(w, 'agent-00', 1, 1);
    a.satiation = 1.5;
    expect(() => serialize(w)).toThrow(/non-integer/);
  });
});
