// Append-only SQLite event store (better-sqlite3). The `events` table is INSERT-only —
// never UPDATE/DELETE — so history is immutable (CLAUDE.md invariant #2). The seed lives
// inside the GENESIS event, so the log alone fully determines state; the `runs` table is a
// convenience index for the UI only, NEVER the source of the seed or of replay.
import Database from 'better-sqlite3';
import type { Event, World } from '../engine/index.js';
import { serialize } from '../engine/index.js';
import { type EventStore, type LlmCallRow, replayEvents } from './eventStore.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_id     TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  seq     INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL,
  tick    INTEGER NOT NULL,
  type    TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id, seq);
-- The LLM-call sidecar (Phase 3). NOT part of replay: state is derived from the events table
-- alone, and this table could be dropped without changing a single tick of any run. It exists for
-- invariant #7 (every LLM call is recorded: prompt, response, model, tokens, cost) and for cost
-- accounting. The payload column is opaque JSON the store never parses -- so Phase 4 can enrich
-- the record without a migration. No API key is ever written here (invariant #6).
CREATE TABLE IF NOT EXISTS llm_calls (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id   TEXT NOT NULL,
  call_ref TEXT NOT NULL,
  tick     INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  payload  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_llm_calls_run ON llm_calls(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_llm_calls_ref ON llm_calls(run_id, call_ref);
`;

interface EventRow {
  payload: string;
}

interface LlmCallRowRaw {
  call_ref: string;
  tick: number;
  agent_id: string;
  payload: string;
}

export class SqliteEventStore implements EventStore {
  private readonly db: Database.Database;
  private readonly insertEvent: Database.Statement;
  private readonly insertRun: Database.Statement;
  private readonly insertLlmCall: Database.Statement;

  constructor(filename = ':memory:') {
    this.db = new Database(filename);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(SCHEMA);
    this.insertEvent = this.db.prepare('INSERT INTO events (run_id, tick, type, payload) VALUES (?, ?, ?, ?)');
    this.insertRun = this.db.prepare('INSERT OR IGNORE INTO runs (run_id, created_at) VALUES (?, ?)');
    this.insertLlmCall = this.db.prepare('INSERT INTO llm_calls (run_id, call_ref, tick, agent_id, payload) VALUES (?, ?, ?, ?, ?)');
  }

  append(runId: string, tick: number, events: readonly Event[]): void {
    // `now` here is metadata only (run listing) and never feeds the deterministic engine.
    this.insertRun.run(runId, Date.now());
    const tx = this.db.transaction((batch: readonly Event[]) => {
      for (const e of batch) this.insertEvent.run(runId, tick, e.type, JSON.stringify(e));
    });
    tx(events);
  }

  read(runId: string): Event[] {
    const rows = this.db.prepare('SELECT payload FROM events WHERE run_id = ? ORDER BY seq').all(runId) as EventRow[];
    return rows.map((r) => JSON.parse(r.payload) as Event);
  }

  runExists(runId: string): boolean {
    const row = this.db.prepare('SELECT 1 FROM runs WHERE run_id = ?').get(runId);
    return row !== undefined;
  }

  appendLlmCall(runId: string, row: LlmCallRow): void {
    this.insertRun.run(runId, Date.now());
    this.insertLlmCall.run(runId, row.callRef, row.tick, row.agentId, row.payload);
  }

  readLlmCalls(runId: string): LlmCallRow[] {
    const rows = this.db.prepare('SELECT call_ref, tick, agent_id, payload FROM llm_calls WHERE run_id = ? ORDER BY seq').all(runId) as LlmCallRowRaw[];
    return rows.map((r) => ({ callRef: r.call_ref, tick: r.tick, agentId: r.agent_id, payload: r.payload }));
  }

  replay(runId: string): World {
    return replayEvents(this.read(runId));
  }

  serializedState(runId: string): string {
    return serialize(this.replay(runId));
  }

  // Fork-from-tick-N: copy every event with tick ≤ upToTick (including this run's GENESIS)
  // into a fresh run, which the orchestrator can then continue. Immutable history: the
  // source run is untouched.
  fork(sourceRunId: string, upToTick: number, newRunId: string): string {
    if (this.runExists(newRunId)) throw new Error(`fork target run '${newRunId}' already exists`);
    this.insertRun.run(newRunId, Date.now());
    this.db
      .prepare(
        `INSERT INTO events (run_id, tick, type, payload)
         SELECT ?, tick, type, payload FROM events WHERE run_id = ? AND tick <= ? ORDER BY seq`,
      )
      .run(newRunId, sourceRunId, upToTick);
    return newRunId;
  }

  listRuns(): string[] {
    const rows = this.db.prepare('SELECT run_id FROM runs ORDER BY created_at').all() as { run_id: string }[];
    return rows.map((r) => r.run_id);
  }

  close(): void {
    this.db.close();
  }
}
