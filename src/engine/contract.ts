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
// its own tile + a radius of PERCEPTION_RADIUS, its own inventory and stats, and
// nearby agents' positions (+ a `distress` flag) — NEVER their inventory or stats,
// NEVER global state, NEVER the event log.
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
}

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
