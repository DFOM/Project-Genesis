// step() ties the referee's decision to the engine's reducer. It is the `(state, actions[])
// → {state, events[]}` of CLAUDE.md invariant #1. Pure and deterministic: decide reads state
// and emits events; applyEvent folds them to the next state. Live simulation and replay use
// the SAME applyEvent, so replay is byte-identical by construction.
import { applyEvent } from '../engine/index.js';
import type { World, ProposedAction, Event } from '../engine/index.js';
import { decide } from './decide.js';

export function step(world: World, proposed: readonly ProposedAction[]): { world: World; events: Event[] } {
  const events = decide(world, proposed);
  let next: World | null = world;
  for (const e of events) next = applyEvent(next, e);
  return { world: next, events };
}
