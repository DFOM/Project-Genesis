// SQLite append-only store: replay reconstructs state from the log alone, and fork-from-N
// reproduces the state at tick N. (Uses an in-memory SQLite db — no disk.)
import { describe, it, expect } from 'vitest';
import { serialize } from '../src/engine/index.js';
import { SqliteEventStore } from '../src/store/index.js';
import { Simulation, heuristicBot, makeConfig } from '../src/orchestrator/index.js';

describe('sqlite event store', () => {
  it('replays the event log to the identical live state', async () => {
    const store = new SqliteEventStore(':memory:');
    const sim = Simulation.create('run-a', makeConfig(42), store, heuristicBot);
    await sim.run(50);
    expect(serialize(store.replay('run-a'))).toBe(serialize(sim.world));
    store.close();
  });

  it('fork-from-tick-N reproduces the state at tick N', async () => {
    const store = new SqliteEventStore(':memory:');
    const sim = Simulation.create('run-b', makeConfig(7), store, heuristicBot);
    await sim.run(10);
    const stateAt10 = serialize(sim.world);
    await sim.run(10); // advance to tick 20; history for ticks ≤10 is immutable
    store.fork('run-b', 10, 'run-b-fork');
    expect(serialize(store.replay('run-b-fork'))).toBe(stateAt10);
    store.close();
  });
});
