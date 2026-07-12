// THE DONE TEST (balance half). Some agents starve/dehydrate, some survive. Kept SEPARATE
// from the determinism gate so a tuning change fails here, never there.
import { describe, it, expect } from 'vitest';
import { runHeadless } from '../src/orchestrator/harness.js';

describe('balance', () => {
  it('at seed 42 over 5,000 ticks, some die and some survive (0 < deaths < 30)', async () => {
    const r = await runHeadless(42, 5000);
    expect(r.dead).toBeGreaterThan(0);
    expect(r.dead).toBeLessThan(30);
  });
});
