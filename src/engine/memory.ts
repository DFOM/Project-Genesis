// Pure, deterministic memory: run-length COALESCING of consecutive identical facts, plus
// bounded eviction by an importance TIER minus a LOGARITHMIC age penalty. Coalescing stops a
// stutter (twenty identical "gather rejected" in a row) from filling the buffer and evicting
// everything socially meaningful; salience-with-decay lets a witnessed death dominate for a long
// while yet eventually yield to fresh events (never frozen — reputation stays revisable).
//
// Arithmetic (TIER_WEIGHT=500, DECAY_WEIGHT=100): a `witnessed_died` (tier 12) falls below a
// FRESH `rejected` (tier 10) when 100·log2(1+age) > (12−10)·500 = 1000 → age > 2^10 − 1 ≈ 1023
// ticks. It falls below a FRESH `gathered` (tier 5) only when age > 2^35 → effectively never.
import * as C from './config.js';
import type { MemoryEntry, MemoryFact } from './contract.js';

// Importance tier (higher = more worth keeping). Age is applied separately in score().
export function tier(e: MemoryEntry | MemoryFact): number {
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
      return e.lastUnit ? 8 : 7; // taking the LAST unit from under you is more memorable
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

// Decayed salience. Age is measured from `lastTick` (the most-recent occurrence), so a coalesced
// entry that keeps recurring stays fresh. Integer-floored; never serialized (only the entry is).
export function score(e: MemoryEntry, nowTick: number): number {
  const age = nowTick - e.lastTick;
  return tier(e) * C.TIER_WEIGHT - Math.floor(C.DECAY_WEIGHT * Math.log2(1 + age));
}

// Signature of a fact's kind + payload (excluding tick/lastTick/count) — deterministic; two
// facts coalesce iff their signatures are equal. Keys keep construction order, identical between
// a fresh fact and a stored entry built from the same shape.
function signature(e: MemoryEntry | MemoryFact): string {
  const rest: Record<string, unknown> = { ...e };
  delete rest.tick;
  delete rest.lastTick;
  delete rest.count;
  return JSON.stringify(rest);
}

// Record `fact`: if it matches an entry within the last COALESCE_LOOKBACK (same kind + payload),
// coalesce in place (bump count, extend lastTick) — one slot, not a new one. Bounded lookback (not
// just the immediately-preceding entry) so a single interleaved `appeared` between two rejections
// doesn't split the run back into a stutter. Otherwise append; if that pushes past MEMORY_CAPACITY,
// evict the LOWEST-scoring entry. Ties: older lastTick, then earliest array index — deterministic.
export function remember(memory: MemoryEntry[], fact: MemoryFact, nowTick: number): void {
  const sig = signature(fact);
  const start = Math.max(0, memory.length - C.COALESCE_LOOKBACK);
  for (let i = memory.length - 1; i >= start; i--) {
    if (signature(memory[i]!) === sig) {
      memory[i]!.count += 1;
      memory[i]!.lastTick = fact.tick;
      return;
    }
  }
  memory.push({ ...fact, lastTick: fact.tick, count: 1 });
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
