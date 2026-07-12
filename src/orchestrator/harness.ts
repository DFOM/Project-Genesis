// Shared helpers for running a heuristic-bot world headless — used by the CLI, the
// determinism test, and the balance test so there is exactly one run path.
import { config as engineConfig } from '../engine/index.js';
import type { Event, RunConfig } from '../engine/index.js';
import { heuristicBot } from '../agents/index.js';
import { InMemoryEventStore, replayEvents } from '../store/index.js';
import { serialize } from '../engine/index.js';
import { Simulation } from './simulation.js';

export interface HeadlessResult {
  runId: string;
  ticks: number;
  alive: number;
  dead: number;
  finalState: string; // canonical serialization of the final world
  events: Event[]; // the full event log for this run
}

export function makeConfig(seed: number): RunConfig {
  return { seed, agentCount: engineConfig.AGENT_COUNT };
}

// Run `ticks` steps of a fresh bot world from `seed`. Deterministic given (seed, ticks).
export async function runHeadless(seed: number, ticks: number): Promise<HeadlessResult> {
  const store = new InMemoryEventStore();
  const runId = `run-${seed}`;
  const sim = Simulation.create(runId, makeConfig(seed), store, heuristicBot);
  await sim.run(ticks);
  return {
    runId,
    ticks,
    alive: sim.aliveCount(),
    dead: sim.deadCount(),
    finalState: sim.serialized(),
    events: store.read(runId),
  };
}

// Fold an event log back to a canonical final-state string (the replay path).
export function replayToState(events: readonly Event[]): string {
  return serialize(replayEvents(events));
}
