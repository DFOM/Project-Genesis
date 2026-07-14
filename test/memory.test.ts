// Social memory: records own + witnessed acts (within radius), coalesces consecutive identical
// facts into one slot, is bounded and evicted by salience-that-decays (old grief eventually
// yields to fresh events), and replays byte-identically.
import { describe, it, expect } from 'vitest';
import { remember, score } from '../src/engine/memory.js';
import type { MemoryEntry } from '../src/engine/index.js';
import * as C from '../src/engine/config.js';
import { step } from '../src/referee/index.js';
import { runHeadless, replayToState } from '../src/orchestrator/harness.js';
import { tinyWorld, addAgent, addNode, agentOf } from './helpers.js';

const died = (tick: number): MemoryEntry => ({ tick, lastTick: tick, count: 1, kind: 'witnessed_died', who: 'ghost', cause: 'starvation', tile: { x: 0, y: 0 } });
const gathered = (tick: number): MemoryEntry => ({ tick, lastTick: tick, count: 1, kind: 'gathered', item: 'grain', qty: 1 });
const rested = (tick: number): MemoryEntry => ({ tick, lastTick: tick, count: 1, kind: 'rested' });
const rejGather = (tick: number): MemoryEntry => ({ tick, lastTick: tick, count: 1, kind: 'rejected', action: { type: 'GATHER' }, reason: 'nothing to gather here' });
const wg = (tick: number, who: string): MemoryEntry => ({ tick, lastTick: tick, count: 1, kind: 'witnessed_gathered', who, item: 'grain', qty: 1, tile: { x: 5, y: 5 }, lastUnit: true });
const rejReason = (tick: number, reason: string): MemoryEntry => ({ tick, lastTick: tick, count: 1, kind: 'rejected', action: { type: 'GATHER' }, reason });

describe('memory — social witnessing', () => {
  it('an in-radius observer records who took the last unit; a far agent does not', () => {
    const w = tinyWorld(40);
    addAgent(w, 'agent-01', 10, 10);
    addNode(w, 'grain', 10, 10, 1);
    addAgent(w, 'agent-00', 13, 10); // in radius
    addAgent(w, 'agent-02', 39, 0); // far
    const { world } = step(w, [{ agentId: 'agent-01', action: { type: 'GATHER' } }]);
    const seen = agentOf(world, 'agent-00').memory.find((m) => m.kind === 'witnessed_gathered');
    expect(seen && seen.kind === 'witnessed_gathered' && seen.who).toBe('agent-01');
    expect(agentOf(world, 'agent-02').memory.some((m) => m.kind === 'witnessed_gathered')).toBe(false);
  });
});

describe('memory — coalescing (the stutter fix)', () => {
  it('19 identical rejections collapse into ONE slot, freeing room for a witnessed_gathered', () => {
    const mem: MemoryEntry[] = [];
    remember(mem, wg(10, 'thief'), 10); // the socially meaningful fact
    for (let t = 11; t <= 29; t++) remember(mem, rejGather(t), t); // 19 identical rejections
    const rej = mem.filter((m) => m.kind === 'rejected');
    expect(rej).toHaveLength(1); // one slot, not nineteen
    expect(rej[0]!.count).toBe(19);
    expect(rej[0]!.tick).toBe(11);
    expect(rej[0]!.lastTick).toBe(29);
    // …and the witnessed_gathered from the same window was NOT crowded out
    expect(mem.some((m) => m.kind === 'witnessed_gathered' && m.who === 'thief')).toBe(true);
  });

  it('coalesces across an interleaved entry (bounded lookback), not just the immediate predecessor', () => {
    const mem: MemoryEntry[] = [];
    remember(mem, rejGather(11), 11);
    remember(mem, { tick: 11, kind: 'appeared', who: 'x' }, 11); // interleaved
    remember(mem, rejGather(12), 12); // must still coalesce into the rejection 2 slots back
    const rej = mem.filter((m) => m.kind === 'rejected');
    expect(rej).toHaveLength(1);
    expect(rej[0]!.count).toBe(2);
    expect(mem.some((m) => m.kind === 'appeared')).toBe(true);
  });
});

describe('memory — salience eviction with decay', () => {
  it('a witnessed death survives sustained pressure from DISTINCT routine entries', () => {
    const mem: MemoryEntry[] = [];
    remember(mem, died(10), 10);
    for (let i = 0; i < 25; i++) remember(mem, wg(11 + i, `a${i}`), 11 + i); // distinct → no coalesce
    expect(mem.length).toBe(C.MEMORY_CAPACITY);
    expect(mem.some((m) => m.kind === 'witnessed_died')).toBe(true); // a routine witnessed_gathered was evicted, not the death
  });

  it('but a STALE death is eventually displaced by fresh salient events — memory is not frozen', () => {
    const mem: MemoryEntry[] = [];
    remember(mem, died(10), 10);
    // ~1100 ticks later, 20 DISTINCT fresh rejections fill the buffer; the decayed death is lowest.
    for (let i = 0; i < C.MEMORY_CAPACITY; i++) remember(mem, rejReason(1100, `r${i}`), 1100);
    expect(mem.some((m) => m.kind === 'witnessed_died')).toBe(false);
  });

  it('late-run tier regression: log-decay keeps tiers meaningful (linear would not)', () => {
    expect(score(died(4900), 4900)).toBeGreaterThan(score(rested(4900), 4900));
    // a VERY old death still outranks a fresh routine gather (linear decay would flip this).
    expect(score(died(100), 4900)).toBeGreaterThan(score(gathered(4900), 4900));
  });
});

describe('memory — event-sourced', () => {
  it('replay reconstructs identical memory (folding the log reproduces state byte-for-byte)', async () => {
    const r = await runHeadless(42, 200);
    expect(replayToState(r.events)).toBe(r.finalState);
  });
});
