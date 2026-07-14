// Pure, deterministic memory scoring + bounded eviction for the per-agent social memory.
// Salience = an importance TIER minus a LOGARITHMIC age penalty, so a witnessed death dominates
// routine entries for a long while yet a stale death is eventually displaced by an accumulation
// of fresh salient events — memory is never permanently frozen, and reputation (recent
// behaviour) can be revised. Linear decay would instead degenerate the tiers into a plain
// recency ring (a tick-4990 `rested` would outscore a tick-100 `witnessed_died`).
//
// Arithmetic (TIER_WEIGHT=500, DECAY_WEIGHT=100): a `witnessed_died` (tier 12) falls below a
// FRESH `rejected` (tier 10) when 100·log2(1+age) > (12−10)·500 = 1000 → age > 2^10 − 1 ≈ 1023
// ticks. It falls below a FRESH `gathered` (tier 5) only when 100·log2(1+age) > 3500 →
// age > 2^35 ≈ 3.4×10^10 → effectively never within a run (routine gathers never displace a
// remembered death; only fresher salient events do).
import * as C from './config.js';
import type { MemoryEntry } from './contract.js';

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

// Decayed salience. Integer-floored so comparisons are stable. NEVER serialized — only the
// resulting memory array is — so this stays inside the integer-math rule.
export function score(e: MemoryEntry, nowTick: number): number {
  const age = nowTick - e.tick;
  return tier(e) * C.TIER_WEIGHT - Math.floor(C.DECAY_WEIGHT * Math.log2(1 + age));
}

// Append `entry`; if that pushes past MEMORY_CAPACITY, evict the LOWEST-scoring entry. Ties are
// broken by older tick, then earliest array index — fully deterministic, never object identity.
// Mutates `memory` in place (the reducer mutates World for performance; see reducer.ts).
export function remember(memory: MemoryEntry[], entry: MemoryEntry, nowTick: number): void {
  memory.push(entry);
  if (memory.length <= C.MEMORY_CAPACITY) return;
  let evict = 0;
  let evictScore = score(memory[0]!, nowTick);
  for (let i = 1; i < memory.length; i++) {
    const s = score(memory[i]!, nowTick);
    if (s < evictScore || (s === evictScore && memory[i]!.tick < memory[evict]!.tick)) {
      evict = i;
      evictScore = s;
    }
  }
  memory.splice(evict, 1);
}
