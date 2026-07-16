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

// ── the LLM-call sidecar (Phase 3) ───────────────────────────────────────────
// The HEAVY half of an LLM call: prompt, token usage, cost, latency. Its light half — the raw
// response — is a REASONED event in the log above, sitting next to the action it produced. The
// two join on `callRef`.
//
// WHY `payload` IS OPAQUE. The store may not import from src/agents (dependency-cruiser:
// 'store-imports-engine-only'), and agents may not import the store — so neither layer can own a
// shared record type. That constraint turns out to be right: a store's job is to persist rows and
// index the columns you query on. It indexes what it must (run, tick, agent, callRef) and treats
// the rest as an opaque JSON blob it never interprets. The bonus is that Phase 4 can enrich the
// record — more providers, more fields — with no schema migration here.
export interface LlmCallRow {
  callRef: string; // pure fn of (tick, agentId, callIndex) — joins to the REASONED event
  tick: number;
  agentId: string;
  payload: string; // JSON LlmCallRecord — opaque to the store, never parsed here
}

// Append-only: implementations may ONLY insert. History is immutable — never UPDATE/DELETE.
export interface EventStore {
  append(runId: string, tick: number, events: readonly Event[]): void;
  read(runId: string): Event[];
  runExists(runId: string): boolean;
  // Sidecar. Separate from `append` because these are not events: they change no state and are
  // not part of replay. Keys never appear in a row (invariant #6).
  appendLlmCall(runId: string, row: LlmCallRow): void;
  readLlmCalls(runId: string): LlmCallRow[];
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
  private readonly llmCalls = new Map<string, LlmCallRow[]>();
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

  appendLlmCall(runId: string, row: LlmCallRow): void {
    let rows = this.llmCalls.get(runId);
    if (!rows) {
      rows = [];
      this.llmCalls.set(runId, rows);
    }
    rows.push(row);
  }

  readLlmCalls(runId: string): LlmCallRow[] {
    return [...(this.llmCalls.get(runId) ?? [])];
  }

  replay(runId: string): World {
    return replayEvents(this.read(runId));
  }
}
