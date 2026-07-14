// ── THE CONTRACT ─────────────────────────────────────────────────────────────
// The honest bot↔engine interface. In Phase 3 an LLM adapter implements the SAME
// `Mind` interface a heuristic bot implements today: it receives a bounded
// `Perception` and returns proposed `Action[]`. It never sees World, never mutates
// anything. Nothing in this file may leak world internals — agents import ONLY this.
//
// All engine scalars are INTEGERS everywhere (see engine/rng + serialize): floats
// would make cross-machine hashing non-reproducible.

export type Dir = 'N' | 'S' | 'E' | 'W';

// grain (east) = food, water (south) = drink — both survival-critical, geographically
// separated, so no tile is self-sufficient. ore (north) is DELIBERATELY useless: not
// edible, not drinkable, not craftable. It is the money candidate for the Phase-6
// Currency detector. Do NOT give ore a use.
export type ItemType = 'ore' | 'water' | 'grain';

// What an agent PROPOSES. The actor id is attached by the orchestrator; agents do not
// self-identify state. Phase 1: at most ONE action per agent per tick — extras rejected.
export type Action =
  | { type: 'MOVE'; dir: Dir }
  | { type: 'GATHER' } // pick up from the node AND/OR ground stack on the agent's own tile
  | { type: 'EAT'; item: ItemType } // grain only; raises satiation; else rejected
  | { type: 'DRINK'; item: ItemType } // water only; raises hydration; else rejected
  | { type: 'DROP'; item: ItemType; qty: number } // lands on the tile ground stack (not destroyed)
  | { type: 'REST' };

// The bounded view. Built by perceive(); contains ONLY what this agent may see:
// its own tile + a radius of PERCEPTION_RADIUS, its own inventory/stats/memory, and
// nearby agents' positions (+ a `distress` flag) — NEVER their inventory or stats,
// NEVER global state, NEVER the event log.
//
// `memory` is SOCIAL: the agent's own recent events PLUS witnessed acts of others it saw
// within its radius (observable acts only — who did what, where — never anyone's private
// state). It is what makes reputation/grudges/trust possible in later phases.
//
// FIELD NAMING IS PART OF THE CONTRACT: these names go straight into an LLM prompt in
// Phase 3. Use satiation/hydration (high = well, 0 = the need is unmet), NOT
// hunger/thirst — a model reading `hunger: 2` would conclude it isn't hungry and starve.
export interface Perception {
  tick: number; // deterministic clock — lets a pure bot derive a wander direction by hashing
  self: {
    id: string;
    pos: { x: number; y: number };
    inventory: Record<ItemType, number>; // OWN inventory only
    capacity: number; // max total items held — so the bot can foresee 'inventory full'
    satiation: number; // integer, high = well fed
    hydration: number; // integer, high = well watered
    energy: number; // integer; MOVE costs it, REST restores it; at 0, MOVE is rejected
    health: number; // integer; drains while a need is at 0, death at 0
  };
  tiles: PerceivedTile[]; // the agent's tile + everything within PERCEPTION_RADIUS
  agents: PerceivedAgent[]; // visible others — positions + distress only
  memory: MemoryEntry[]; // own + witnessed recent events, oldest→newest, ≤ MEMORY_CAPACITY
}

type Vec2 = { x: number; y: number };

// A single observed fact, as constructed by the reducer per event (one occurrence). Every field
// is observable: item/qty/tile/cause and a public agent id (`who`) — NEVER another agent's
// inventory, satiation, hydration, energy, or health. ('moved' is not recorded — it's noise.)
export type MemoryFact = { tick: number } & (
  // ── the agent's OWN experienced events ──
  | { kind: 'gathered'; item: ItemType; qty: number }
  | { kind: 'ate'; item: ItemType }
  | { kind: 'drank'; item: ItemType }
  | { kind: 'dropped'; item: ItemType; qty: number }
  | { kind: 'rested' }
  | { kind: 'rejected'; action: Action; reason: string }
  | { kind: 'starving' | 'dehydrating' }
  // ── SOCIAL: acts observed within radius, tagged with the actor's public id ──
  | { kind: 'witnessed_gathered'; who: string; item: ItemType; qty: number; tile: Vec2; lastUnit: boolean }
  | { kind: 'witnessed_dropped'; who: string; item: ItemType; qty: number; tile: Vec2 }
  | { kind: 'witnessed_died'; who: string; cause: 'starvation' | 'dehydration'; tile: Vec2 }
  | { kind: 'witnessed_distress'; who: string }
  | { kind: 'appeared'; who: string }
  | { kind: 'departed'; who: string }
);

// A stored buffer entry: a COALESCED aggregate spanning firstTick…lastTick with a `count`.
//   • SYNTACTIC coalescing (most kinds): consecutive identical facts (within a bounded lookback)
//     collapse — "tried GATHER ×19, rejected: nothing to gather here" is one slot.
//   • SEMANTIC coalescing (witnessed_died / witnessed_gathered): same kind at the same TILE
//     collapse even when non-adjacent — a place-bound generalization (the first *inference* in
//     the system, not a bare fact): "watched 11 die at (20,16), recently agent-19" is one slot;
//     "agent-07 took from (X,Y) 9×, 7 the last unit" is a compressed reputation. `who` is the
//     last-5 witnessed ids; deaths key by tile, gathers key by (who, tile).
type Span = { firstTick: number; lastTick: number; count: number };
export type MemoryEntry =
  | (Span & { kind: 'gathered'; item: ItemType; qty: number })
  | (Span & { kind: 'ate'; item: ItemType })
  | (Span & { kind: 'drank'; item: ItemType })
  | (Span & { kind: 'dropped'; item: ItemType; qty: number })
  | (Span & { kind: 'rested' })
  | (Span & { kind: 'rejected'; action: Action; reason: string })
  | (Span & { kind: 'starving' | 'dehydrating' })
  | (Span & { kind: 'witnessed_gathered'; who: string; item: ItemType; tile: Vec2; lastUnitCount: number })
  | (Span & { kind: 'witnessed_dropped'; who: string; item: ItemType; qty: number; tile: Vec2 })
  | (Span & { kind: 'witnessed_died'; tile: Vec2; who: string[] })
  | (Span & { kind: 'witnessed_distress'; who: string })
  | (Span & { kind: 'appeared'; who: string })
  | (Span & { kind: 'departed'; who: string });

export interface PerceivedTile {
  x: number;
  y: number;
  terrain: 'plain' | 'hill' | 'water' | 'field';
  passable: boolean; // false for 'water' terrain — MOVE onto it is rejected
  resource?: { item: ItemType; stock: number }; // a regenerating node on this tile, if any
  ground?: Partial<Record<ItemType, number>>; // dropped items resting on this tile, if any
}

export interface PerceivedAgent {
  id: string;
  pos: { x: number; y: number };
  distress: boolean; // health is draining (a need is at 0) — visible so others can aid/exploit
}

// The interface bots implement now and LLM adapters implement in Phase 3 (async-ready).
export interface Mind {
  id: string;
  propose(p: Perception): Action[] | Promise<Action[]>;
}
