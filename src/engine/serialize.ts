// Canonical serialization for byte-identical comparison + hashing. Object keys are sorted
// recursively; arrays keep their (already-canonical) order. All scalars are integers, so
// there are no float-formatting hazards. No Map/Set — no iteration-order surprises.
import type { World } from './types.js';

type Json = null | number | string | boolean | Json[] | { [k: string]: Json };

function stable(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    // All engine scalars are integers; guard against accidental floats/NaN slipping in.
    if (!Number.isInteger(value)) throw new Error(`non-integer scalar in world state: ${value}`);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${stable(obj[k])}`);
  return `{${parts.join(',')}}`;
}

// Deterministic, canonical string form of the entire world.
export function serialize(world: World): string {
  return stable(world as unknown as Json);
}
