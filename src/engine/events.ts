// The append-only fact log. EVERY state change is an Event; nothing mutates World except
// applyEvent(). The event log alone is sufficient to reconstruct state: GENESIS is a full
// constructor (see reducer.ts), so replay folds from `null`.
//
// Events carry CONCRETE outcomes (the resulting values), not intentions — the referee's
// `decide` computes the outcome and bakes it in; `applyEvent` merely writes it. That keeps
// the rules in one place and makes applyEvent a trivial, deterministic writer.
import type { Action, ItemType } from './contract.js';
import type { RunConfig, Vec } from './types.js';
import type { RngState } from './rng.js';

export type DeathCause = 'starvation' | 'dehydration';

// Per-agent metabolism result for a tick (batched — one METABOLIZED event carries all of
// them, rather than 30 events/tick × 5,000 ticks of noise). The starving/dehydrating
// counters persist across ticks (how long each need has been at 0) and pick the death cause.
export interface MetabolismDelta {
  agentId: string;
  satiationAfter: number;
  hydrationAfter: number;
  healthAfter: number;
  starvingTicksAfter: number;
  dehydratingTicksAfter: number;
}

export type Event =
  // The ONLY event that constructs state from nothing. Carries the seed, so the log is
  // self-sufficient — no runs table needed to replay.
  | { type: 'GENESIS'; config: RunConfig }
  | { type: 'MOVED'; agentId: string; from: Vec; to: Vec; energyAfter: number }
  | { type: 'GATHERED'; agentId: string; item: ItemType; qty: number; source: 'node' | 'ground'; tile: Vec }
  | { type: 'ATE'; agentId: string; item: ItemType; satiationAfter: number }
  | { type: 'DRANK'; agentId: string; item: ItemType; hydrationAfter: number }
  | { type: 'DROPPED'; agentId: string; item: ItemType; qty: number; tile: Vec }
  | { type: 'RESTED'; agentId: string; energyAfter: number }
  | { type: 'REGEN'; tile: Vec; amount: number }
  | { type: 'METABOLIZED'; deltas: MetabolismDelta[] }
  | { type: 'AGENT_DIED'; agentId: string; cause: DeathCause }
  | { type: 'ACTION_REJECTED'; agentId: string; action: Action; reason: string }
  | { type: 'TICK_COMPLETED'; tick: number; rng: RngState };

export type EventType = Event['type'];
