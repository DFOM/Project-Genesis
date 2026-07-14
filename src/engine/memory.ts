// Pure, deterministic memory: two kinds of COALESCING plus bounded eviction by an importance
// TIER minus a LOGARITHMIC age penalty (scored from lastTick).
//   • SYNTACTIC — consecutive identical facts within COALESCE_LOOKBACK collapse (a stutter of
//     "gather rejected" can't fill the buffer; a single interleaved 'appeared' can't split it).
//   • SEMANTIC — witnessed_died / witnessed_gathered coalesce by PLACE even when non-adjacent:
//     all deaths at a tile become one "watched N die here" entry (a place-bound generalization —
//     the first inference in the system), and one agent's repeated takings at a tile become a
//     compressed reputation. This is what keeps a survivor's steady-state buffer from becoming a
//     mass-grave register of eleven separate death rows.
//
// Arithmetic (TIER_WEIGHT=500, DECAY_WEIGHT=100): a witnessed_died (tier 12) falls below a fresh
// rejected (tier 10) at age ~1023 ticks; below a fresh gathered (tier 5) only at age ~2^35 (never
// in a run). No faster decay and no per-tier cap — both would break the tier ordering.
import * as C from './config.js';
import type { MemoryEntry, MemoryFact } from './contract.js';

const WHO_CAP = 5; // keep the last-5 witnessed ids on a semantic entry

// Importance tier (higher = more worth keeping). Age is applied separately in score().
export function tier(e: MemoryEntry): number {
  switch (e.kind) {
    case 'witnessed_died':
      return 12;
    case 'starving':
    case 'dehydrating':
      return 11;
    case 'rejected':
      return 10;
    case 'witnessed_distress':
      return 9;
    case 'witnessed_gathered':
      return e.lastUnitCount > 0 ? 8 : 7; // ever took the LAST unit here → more memorable
    case 'witnessed_dropped':
      return 6;
    case 'gathered':
      return 5;
    case 'ate':
    case 'drank':
      return 4;
    case 'dropped':
      return 3;
    case 'appeared':
    case 'departed':
      return 2;
    case 'rested':
      return 1;
    default: {
      const _exhaustive: never = e;
      throw new Error(`unranked memory entry ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// Decayed salience, aged from lastTick (a recurring place stays fresh). Integer-floored; never
// serialized (only the entry is) — stays inside the integer-math rule.
export function score(e: MemoryEntry, nowTick: number): number {
  const age = nowTick - e.lastTick;
  return tier(e) * C.TIER_WEIGHT - Math.floor(C.DECAY_WEIGHT * Math.log2(1 + age));
}

// The place key for a SEMANTIC kind, or null for syntactic kinds. Deaths key by tile (a deadly
// place); gathers key by (who, tile) (a reputation at a place); rejections key by (reason, tile)
// (a place-bound lesson — "the node at (20,16) is dead").
function semanticKey(x: MemoryFact | MemoryEntry): string | null {
  if (x.kind === 'witnessed_died') return `d@${x.tile.x},${x.tile.y}`;
  if (x.kind === 'witnessed_gathered') return `g@${x.who}@${x.tile.x},${x.tile.y}`;
  if (x.kind === 'rejected') return `r@${x.reason}@${x.tile.x},${x.tile.y}`;
  return null;
}

// Signature of a syntactic fact's kind + payload (excluding span fields) — two facts coalesce
// iff equal. Deterministic: keys keep construction order.
function signature(x: MemoryFact | MemoryEntry): string {
  const rest: Record<string, unknown> = { ...x };
  delete rest.tick;
  delete rest.firstTick;
  delete rest.lastTick;
  delete rest.count;
  return JSON.stringify(rest);
}

// Build a fresh single-occurrence entry from a fact (semantic kinds start their aggregate here).
function factToEntry(f: MemoryFact): MemoryEntry {
  const span = { firstTick: f.tick, lastTick: f.tick, count: 1 };
  switch (f.kind) {
    case 'gathered':
      return { ...span, kind: 'gathered', item: f.item, qty: f.qty };
    case 'ate':
      return { ...span, kind: 'ate', item: f.item };
    case 'drank':
      return { ...span, kind: 'drank', item: f.item };
    case 'dropped':
      return { ...span, kind: 'dropped', item: f.item, qty: f.qty };
    case 'rested':
      return { ...span, kind: 'rested' };
    case 'rejected':
      return { ...span, kind: 'rejected', action: f.action, reason: f.reason, tile: { x: f.tile.x, y: f.tile.y } };
    case 'starving':
    case 'dehydrating':
      return { ...span, kind: f.kind };
    case 'witnessed_gathered':
      return { ...span, kind: 'witnessed_gathered', who: f.who, item: f.item, tile: { x: f.tile.x, y: f.tile.y }, lastUnitCount: f.lastUnit ? 1 : 0 };
    case 'witnessed_dropped':
      return { ...span, kind: 'witnessed_dropped', who: f.who, item: f.item, qty: f.qty, tile: { x: f.tile.x, y: f.tile.y } };
    case 'witnessed_died':
      return { ...span, kind: 'witnessed_died', tile: { x: f.tile.x, y: f.tile.y }, who: [f.who] };
    case 'witnessed_distress':
      return { ...span, kind: 'witnessed_distress', who: f.who };
    case 'appeared':
      return { ...span, kind: 'appeared', who: f.who };
    case 'departed':
      return { ...span, kind: 'departed', who: f.who };
    default: {
      const _exhaustive: never = f;
      throw new Error(`unhandled memory fact ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// Fold a new occurrence into an existing semantic entry (place-bound generalization).
function mergeSemantic(entry: MemoryEntry, f: MemoryFact): void {
  entry.count += 1;
  entry.lastTick = f.tick;
  if (entry.kind === 'witnessed_died' && f.kind === 'witnessed_died') {
    entry.who = [...entry.who, f.who].slice(-WHO_CAP); // last-5 most recent
  } else if (entry.kind === 'witnessed_gathered' && f.kind === 'witnessed_gathered') {
    if (f.lastUnit) entry.lastUnitCount += 1;
  }
}

// Record `fact`. SEMANTIC kinds coalesce with a matching place entry ANYWHERE in the buffer;
// syntactic kinds coalesce with a matching entry within the last COALESCE_LOOKBACK. Otherwise
// append; if that overflows MEMORY_CAPACITY, evict the LOWEST score (ties: older lastTick, then
// earliest index — deterministic, never object identity). test:determinism stays green.
export function remember(memory: MemoryEntry[], fact: MemoryFact, nowTick: number): void {
  const sem = semanticKey(fact);
  if (sem !== null) {
    for (const e of memory) {
      if (semanticKey(e) === sem) {
        mergeSemantic(e, fact);
        return;
      }
    }
  } else {
    const sig = signature(fact);
    const start = Math.max(0, memory.length - C.COALESCE_LOOKBACK);
    for (let i = memory.length - 1; i >= start; i--) {
      const e = memory[i]!;
      if (semanticKey(e) === null && signature(e) === sig) {
        e.count += 1;
        e.lastTick = fact.tick;
        return;
      }
    }
  }
  memory.push(factToEntry(fact));
  if (memory.length <= C.MEMORY_CAPACITY) return;
  let evict = 0;
  let evictScore = score(memory[0]!, nowTick);
  for (let i = 1; i < memory.length; i++) {
    const s = score(memory[i]!, nowTick);
    if (s < evictScore || (s === evictScore && memory[i]!.lastTick < memory[evict]!.lastTick)) {
      evict = i;
      evictScore = s;
    }
  }
  memory.splice(evict, 1);
}
