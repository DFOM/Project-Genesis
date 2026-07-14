// Social memory: it records what an agent did AND what it witnessed others do (within radius),
// is bounded, evicts by salience-that-decays (so old grief eventually yields to fresh events —
// memory is never frozen and reputation is revisable), and is reconstructed exactly by replay.
import { describe, it, expect } from 'vitest';
import { remember, score } from '../src/engine/memory.js';
import type { MemoryEntry } from '../src/engine/index.js';
import * as C from '../src/engine/config.js';
import { step } from '../src/referee/index.js';
import { runHeadless, replayToState } from '../src/orchestrator/harness.js';
import { tinyWorld, addAgent, addNode, agentOf } from './helpers.js';

const died = (tick: number): MemoryEntry => ({ tick, kind: 'witnessed_died', who: 'ghost', cause: 'starvation', tile: { x: 0, y: 0 } });
const gathered = (tick: number): MemoryEntry => ({ tick, kind: 'gathered', item: 'grain', qty: 1 });
const rejected = (tick: number): MemoryEntry => ({ tick, kind: 'rejected', action: { type: 'REST' }, reason: 'x' });

describe('memory — social witnessing', () => {
  it('an in-radius observer records who took the last unit; a far agent does not', () => {
    const w = tinyWorld(40);
    addAgent(w, 'agent-01', 10, 10); // taker, on the node
    addNode(w, 'grain', 10, 10, 1); // one unit → last-unit gather
    addAgent(w, 'agent-00', 13, 10); // watches (dist 3, in radius)
    addAgent(w, 'agent-02', 39, 0); // far
    const { world } = step(w, [{ agentId: 'agent-01', action: { type: 'GATHER' } }]);
    const seen = agentOf(world, 'agent-00').memory.find((m) => m.kind === 'witnessed_gathered');
    expect(seen && seen.kind === 'witnessed_gathered' && seen.who).toBe('agent-01');
    expect(agentOf(world, 'agent-02').memory.some((m) => m.kind === 'witnessed_gathered')).toBe(false);
  });
});

describe('memory — salience eviction with decay', () => {
  it('a witnessed death survives 20 subsequent routine gathers (short-term salience keeps it)', () => {
    const mem: MemoryEntry[] = [];
    remember(mem, died(10), 10);
    for (let i = 0; i < 20; i++) remember(mem, gathered(11 + i), 11 + i);
    expect(mem.length).toBe(C.MEMORY_CAPACITY);
    expect(mem.some((m) => m.kind === 'witnessed_died')).toBe(true); // a gather was evicted, not the death
  });

  it('but a STALE death is eventually displaced by fresh salient events — memory is not frozen', () => {
    const mem: MemoryEntry[] = [];
    remember(mem, died(10), 10);
    // ~1100 ticks later the death has decayed below a fresh rejected (crossover ≈ 1023 ticks);
    // filling the buffer with fresh rejections evicts it.
    for (let i = 0; i < C.MEMORY_CAPACITY; i++) remember(mem, rejected(1100), 1100);
    expect(mem.some((m) => m.kind === 'witnessed_died')).toBe(false);
  });

  it('late-run tier regression: log-decay keeps tiers meaningful (linear would not)', () => {
    // contemporaneous fresh entries at tick 4900 — a death still outranks a rested
    expect(score(died(4900), 4900)).toBeGreaterThan(score({ tick: 4900, kind: 'rested' }, 4900));
    // the real degeneration linear decay causes: a VERY old death vs a fresh routine gather.
    // log-decay retains the death; linear (age≈4800 > 3500 tier gap) would let the gather win.
    expect(score(died(100), 4900)).toBeGreaterThan(score(gathered(4900), 4900));
  });
});

describe('memory — event-sourced', () => {
  it('replay reconstructs identical memory (folding the log reproduces state byte-for-byte)', async () => {
    const r = await runHeadless(42, 200);
    expect(replayToState(r.events)).toBe(r.finalState);
  });
});
