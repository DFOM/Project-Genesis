// The event log is the source of truth (CLAUDE.md invariant #2). This module defines the
// append-only store abstraction and an in-memory implementation. The engine/orchestrator
// depend only on this interface, so the determinism test and the headless runner never
// require native SQLite — they use InMemoryEventStore.
import type { Event, World } from '../engine/index.js';
import { applyEvent } from '../engine/index.js';

export interface StoredEvent {
  seq: number; // global monotonic order within a run
  tick: number; // world tick this event belongs to (GENESIS = 0)
  event: Event;
}

// Append-only: implementations may ONLY insert. History is immutable — never UPDATE/DELETE.
export interface EventStore {
  append(runId: string, tick: number, events: readonly Event[]): void;
  read(runId: string): Event[];
  runExists(runId: string): boolean;
}

// Reconstruct full state by folding the reducer from `null` — GENESIS constructs the world,
// so the event log alone is sufficient (no seed lookup, no `as World` cast).
export function replayEvents(events: readonly Event[]): World {
  let world: World | null = null;
  for (const e of events) world = applyEvent(world, e);
  if (world === null) throw new Error('cannot replay an empty event log (no GENESIS)');
  return world;
}

export class InMemoryEventStore implements EventStore {
  private readonly runs = new Map<string, StoredEvent[]>();
  private seq = 0;

  append(runId: string, tick: number, events: readonly Event[]): void {
    let log = this.runs.get(runId);
    if (!log) {
      log = [];
      this.runs.set(runId, log);
    }
    for (const event of events) log.push({ seq: this.seq++, tick, event });
  }

  read(runId: string): Event[] {
    return (this.runs.get(runId) ?? []).map((s) => s.event);
  }

  runExists(runId: string): boolean {
    return this.runs.has(runId);
  }

  replay(runId: string): World {
    return replayEvents(this.read(runId));
  }
}
