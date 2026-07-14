// Social memory: records own + witnessed acts (within radius); coalesces consecutive identical
// facts (syntactic) AND same-kind-same-place facts (semantic — a place-bound generalization);
// is bounded and evicted by salience-that-decays; replays byte-identically.
import { describe, it, expect } from 'vitest';
import { remember, score } from '../src/engine/memory.js';
import type { MemoryEntry, MemoryFact } from '../src/engine/index.js';
import * as C from '../src/engine/config.js';
import { step } from '../src/referee/index.js';
import { runHeadless, replayToState } from '../src/orchestrator/harness.js';
import { tinyWorld, addAgent, addNode, agentOf } from './helpers.js';

// facts (what the reducer emits) → passed to remember()
const factDied = (tick: number, who: string, tile = { x: 20, y: 20 }): MemoryFact => ({ tick, kind: 'witnessed_died', who, cause: 'starvation', tile });
const factRejGather = (tick: number, tile = { x: 20, y: 16 }): MemoryFact => ({ tick, kind: 'rejected', action: { type: 'GATHER' }, reason: 'nothing to gather here', tile });
const factRejReason = (tick: number, reason: string, tile = { x: 20, y: 16 }): MemoryFact => ({ tick, kind: 'rejected', action: { type: 'GATHER' }, reason, tile });
const factGathered = (tick: number): MemoryFact => ({ tick, kind: 'gathered', item: 'grain', qty: 1 });
const factWg = (tick: number, who: string, lastUnit = true, tile = { x: 5, y: 5 }): MemoryFact => ({ tick, kind: 'witnessed_gathered', who, item: 'grain', qty: 1, tile, lastUnit });
// entries (the stored aggregate) → passed to score()
const entryDied = (firstTick: number, lastTick: number, who: string[]): MemoryEntry => ({ firstTick, lastTick, count: who.length, kind: 'witnessed_died', tile: { x: 20, y: 20 }, who });
const entryRested = (firstTick: number, lastTick: number): MemoryEntry => ({ firstTick, lastTick, count: 1, kind: 'rested' });
const entryGathered = (firstTick: number, lastTick: number): MemoryEntry => ({ firstTick, lastTick, count: 1, kind: 'gathered', item: 'grain', qty: 1 });

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
    expect(seen && seen.kind === 'witnessed_gathered' && seen.lastUnitCount).toBeGreaterThan(0);
    expect(agentOf(world, 'agent-02').memory.some((m) => m.kind === 'witnessed_gathered')).toBe(false);
  });
});

describe('memory — syntactic coalescing (the stutter fix)', () => {
  it('19 identical rejections collapse into ONE slot, freeing room for a witnessed_gathered', () => {
    const mem: MemoryEntry[] = [];
    remember(mem, factWg(10, 'thief'), 10);
    for (let t = 11; t <= 29; t++) remember(mem, factRejGather(t), t);
    const rej = mem.filter((m) => m.kind === 'rejected');
    expect(rej).toHaveLength(1);
    expect(rej[0]!.count).toBe(19);
    expect(rej[0]!.firstTick).toBe(11);
    expect(rej[0]!.lastTick).toBe(29);
    expect(mem.some((m) => m.kind === 'witnessed_gathered' && m.who === 'thief')).toBe(true);
  });

  it('coalesces a syntactic kind across an interleaved entry (bounded lookback)', () => {
    const mem: MemoryEntry[] = [];
    remember(mem, factGathered(11), 11);
    remember(mem, { tick: 11, kind: 'appeared', who: 'x' }, 11); // interleaved
    remember(mem, factGathered(12), 12); // must still coalesce into the gather 2 slots back
    expect(mem.filter((m) => m.kind === 'gathered')).toHaveLength(1);
    expect(mem.find((m) => m.kind === 'gathered')!.count).toBe(2);
  });
});

describe('memory — semantic coalescing of own rejections (place-bound lesson)', () => {
  it('failing GATHER at one tile compresses into a single lesson; a different tile is separate', () => {
    const mem: MemoryEntry[] = [];
    for (let t = 100; t < 140; t++) remember(mem, factRejGather(t, { x: 20, y: 16 }), t); // 40× here
    remember(mem, factRejGather(300, { x: 20, y: 16 }), 300); // far later, SAME place → merges (non-adjacent)
    remember(mem, factRejGather(301, { x: 31, y: 9 }), 301); // a different place → its own lesson
    const rej = mem.filter((m) => m.kind === 'rejected');
    expect(rej).toHaveLength(2);
    const here = rej.find((r) => r.kind === 'rejected' && r.tile.x === 20 && r.tile.y === 16)!;
    if (here.kind !== 'rejected') throw new Error('kind');
    expect(here.count).toBe(41);
    expect(here.firstTick).toBe(100);
    expect(here.lastTick).toBe(300);
  });
});

describe('memory — semantic coalescing (place-bound generalization)', () => {
  it('11 deaths at one tile occupy one slot, keeping the count and last-5 witnesses', () => {
    const mem: MemoryEntry[] = [];
    for (let i = 0; i < 11; i++) remember(mem, factDied(468 + i * 10, `agent-${i}`), 468 + i * 10);
    const wd = mem.filter((m) => m.kind === 'witnessed_died');
    expect(wd).toHaveLength(1);
    const e = wd[0]!;
    if (e.kind !== 'witnessed_died') throw new Error('kind');
    expect(e.count).toBe(11);
    expect(e.firstTick).toBe(468);
    expect(e.lastTick).toBe(468 + 100);
    expect(e.who).toEqual(['agent-6', 'agent-7', 'agent-8', 'agent-9', 'agent-10']); // last 5, most recent last
  });

  it("one agent's repeated takings at a tile compress into a reputation slot", () => {
    const mem: MemoryEntry[] = [];
    for (let t = 100; t < 109; t++) remember(mem, factWg(t, 'agent-07', true), 100); // 9×, all last-unit
    const wg = mem.filter((m) => m.kind === 'witnessed_gathered');
    expect(wg).toHaveLength(1);
    const e = wg[0]!;
    if (e.kind !== 'witnessed_gathered') throw new Error('kind');
    expect(e.who).toBe('agent-07');
    expect(e.count).toBe(9);
    expect(e.lastUnitCount).toBe(9);
  });
});

describe('memory — salience eviction with decay', () => {
  it('a witnessed death survives sustained pressure from DISTINCT routine entries', () => {
    const mem: MemoryEntry[] = [];
    remember(mem, factDied(10, 'ghost'), 10);
    for (let i = 0; i < 25; i++) remember(mem, factWg(11 + i, `a${i}`, true, { x: i, y: 5 }), 11 + i); // distinct place → distinct slots
    expect(mem.length).toBe(C.MEMORY_CAPACITY);
    expect(mem.some((m) => m.kind === 'witnessed_died')).toBe(true);
  });

  it('but a STALE death is eventually displaced by fresh salient events — memory is not frozen', () => {
    const mem: MemoryEntry[] = [];
    remember(mem, factDied(10, 'ghost'), 10);
    for (let i = 0; i < C.MEMORY_CAPACITY; i++) remember(mem, factRejReason(1100, `r${i}`), 1100);
    expect(mem.some((m) => m.kind === 'witnessed_died')).toBe(false);
  });

  it('late-run tier regression: log-decay keeps tiers meaningful (linear would not)', () => {
    expect(score(entryDied(4900, 4900, ['x']), 4900)).toBeGreaterThan(score(entryRested(4900, 4900), 4900));
    expect(score(entryDied(100, 100, ['x']), 4900)).toBeGreaterThan(score(entryGathered(4900, 4900), 4900));
  });
});

describe('memory — event-sourced', () => {
  it('replay reconstructs identical memory (folding the log reproduces state byte-for-byte)', async () => {
    const r = await runHeadless(42, 200);
    expect(replayToState(r.events)).toBe(r.finalState);
  });
});
