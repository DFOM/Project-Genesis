// ── THE CONTRACT ─────────────────────────────────────────────────────────────
// The honest bot↔engine interface. In Phase 3 an LLM adapter implements the SAME
// `Mind` interface a heuristic bot implements today: it receives a bounded
// `Perception` and returns proposed `Action[]`. It never sees World, never mutates
// anything. Nothing in this file may leak world internals — agents import ONLY this.
//
// All engine scalars are INTEGERS everywhere (see engine/rng + serialize): floats
// would make cross-machine hashing non-reproducible.

import * as C from './config.js';

export type Dir = 'N' | 'S' | 'E' | 'W';

// ── THE SCALE ────────────────────────────────────────────────────────────────
// The numbers an agent may know about the world it lives in. Invariant #8: every condition the
// referee can reject on must be visible, so 'too exhausted' means the energy scale is visible,
// 'inventory full' means capacity is, and 'out of bounds' means the map's extent is. A model
// reading `satiation: 2` cannot act on it without knowing the maximum is ${SATIATION_MAX}.
//
// IT IS CURATED, AND THE OMISSIONS ARE THE POINT. `config.ts` also holds GRAIN_MIN_X,
// ORE_BAND_MAX_Y, GRAIN_BAND_MAX_Y, the patch counts — i.e. WHERE THE FOOD IS. An agent that
// could import config would know grain is east and water is south without ever walking there,
// and "will they find the seam?" — a real result in the Phase-1 baseline — would become
// meaningless. That is why `agents-see-only-the-contract` forbids agents from importing config,
// and why this object re-exports the metabolic/action scale and nothing about the map's layout.
//
// Rule for adding to this: if an agent could learn it by LIVING (my food restores this much, I
// cannot move at zero energy, the map ends here), it may go here. If it could only learn it by
// READING OUR SOURCE (there are 4 grain patches, ore is north), it may not.
export const SCALE = {
  worldSize: C.WORLD_SIZE, // 'out of bounds' is a rejection reason ⇒ the extent must be visible
  perceptionRadius: C.PERCEPTION_RADIUS,
  satiationMax: C.SATIATION_MAX,
  hydrationMax: C.HYDRATION_MAX,
  energyMax: C.ENERGY_MAX,
  healthMax: C.HEALTH_MAX,
  inventoryCapacity: C.INVENTORY_CAPACITY,
  satiationDecay: C.SATIATION_DECAY,
  hydrationDecay: C.HYDRATION_DECAY,
  eatGain: C.EAT_GAIN,
  drinkGain: C.DRINK_GAIN,
  moveEnergyCost: C.MOVE_ENERGY_COST,
  restEnergyGain: C.REST_ENERGY_GAIN,
  gatherQty: C.GATHER_QTY,
} as const;

// grain (east) = food, water (south) = drink — both survival-critical, geographically
// separated, so no tile is self-sufficient. ore (north) is DELIBERATELY useless: not
// edible, not drinkable, not craftable. It is the money candidate for the Phase-6
// Currency detector. Do NOT give ore a use.
export type ItemType = 'ore' | 'water' | 'grain';

// What an agent PROPOSES. The actor id is attached by the orchestrator; agents do not
// self-identify state. Phase 1: at most ONE action per agent per tick — extras rejected.
//
// This is the ENGINE'S VERB LIST and it stays closed: institutions are detected, never granted
// (CLAUDE.md invariant #5). `INVALID` below is deliberately NOT a member — it is not a verb.
export type Action =
  | { type: 'MOVE'; dir: Dir }
  | { type: 'GATHER' } // pick up from the node AND/OR ground stack on the agent's own tile
  | { type: 'EAT'; item: ItemType } // grain only; raises satiation; else rejected
  | { type: 'DRINK'; item: ItemType } // water only; raises hydration; else rejected
  | { type: 'DROP'; item: ItemType; qty: number } // lands on the tile ground stack (not destroyed)
  | { type: 'REST' };

// Phase 3 — the ANTI-VERB. When a mind emits something that is not a valid Action (an LLM
// returning malformed JSON, an unknown verb, a schema mismatch, a refusal, a truncated
// response), the adapter proposes this instead of throwing. The referee rejects it like any
// other illegal proposal, so it becomes an ACTION_REJECTED event → coalesced memory → the next
// tick's prompt. A model that errs sees WHY and can adapt; a crash would teach it nothing.
//
// It carries only a STABLE reason CATEGORY, never the raw text: the raw model output already
// lives in the adjacent REASONED event (and the sidecar). Duplicating it here would bloat the
// buffer and, worse, break coalescing — memory keys rejections by (reason, tile), so a category
// that varied per malformed response would spawn a new entry every time instead of compressing
// into one place-bound lesson.
export type InvalidProposal = { type: 'INVALID'; reason: string };

// What a mind may put forward: a real verb, or the anti-verb. The referee accepts both and
// judges both; only `Action` can ever change the world.
export type Proposal = Action | InvalidProposal;

// The model's raw output for one call, carried alongside the proposal it produced so the referee
// can emit it into the log IMMEDIATELY BEFORE that proposal's outcome (see events.ts REASONED).
// `callRef` links this to the heavy LlmCallRecord (prompt/usage/cost) in the store sidecar.
// It MUST be a pure function of (tick, agentId, callIndex) — no uuid, no clock — or two runs of a
// deterministic mock provider would not produce byte-identical logs.
export interface Reasoning {
  rawResponse: string;
  callRef: string;
}

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
  | { kind: 'rejected'; action: Proposal; reason: string; tile: Vec2 } // tile = where it tried
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
  // rejected coalesces SEMANTICALLY by (reason, tile) — "failed to GATHER at (20,16) ×40" is a
  // place-bound lesson (the node is dead), the self-directed twin of "watched 11 die at (20,16)".
  | (Span & { kind: 'rejected'; action: Proposal; reason: string; tile: Vec2 })
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

// What a mind hands back. Two shapes, ONE interface:
//   • `Proposal[]`            — a mind with nothing to say about its own thinking (every bot).
//   • `{ actions, reasoning }` — a mind that reasoned, and wants the thought recorded next to
//                                the consequence (every LLM adapter).
// The bare-array form keeps heuristic bots literally unchanged (`return [decide(p)]` still
// type-checks). The orchestrator normalizes both via `normalizeMindResult`.
export type MindResult = Proposal[] | { actions: Proposal[]; reasoning?: Reasoning };

// The interface bots implement now and LLM adapters implement in Phase 3 (async-ready).
export interface Mind {
  id: string;
  propose(p: Perception): MindResult | Promise<MindResult>;
}

// Normalize either shape to one. Pure; shared by the orchestrator and the diagnostics loop so
// there is exactly one place that knows about the two forms.
export function normalizeMindResult(r: MindResult): { actions: Proposal[]; reasoning?: Reasoning } {
  return Array.isArray(r) ? { actions: r } : r;
}
