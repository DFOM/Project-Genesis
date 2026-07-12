// THE DONE TEST (byte-identity half). 30 bots × 5,000 ticks. No population assertions live
// here — balance lives in balance.test.ts — so a tuning change can never redden this gate.
import { describe, it, expect } from 'vitest';
import { runHeadless, replayToState } from '../src/orchestrator/harness.js';

const SEED = 42;
const TICKS = 5000;

describe('determinism', () => {
  it('replay == live: folding the event log from null reproduces the final state byte-for-byte', async () => {
    const run = await runHeadless(SEED, TICKS);
    expect(replayToState(run.events)).toBe(run.finalState);
  });

  it('run A == run B: the same seed yields identical final state and identical event logs', async () => {
    const a = await runHeadless(SEED, TICKS);
    const b = await runHeadless(SEED, TICKS);
    expect(b.finalState).toBe(a.finalState);
    expect(JSON.stringify(b.events)).toBe(JSON.stringify(a.events));
  });
});
