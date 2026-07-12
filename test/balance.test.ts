// THE DONE TEST (balance half). Some agents starve/dehydrate, some survive. Kept SEPARATE
// from the determinism gate so a tuning change fails here, never there. The range is real:
// too few deaths = a nursery (no scarcity pressure), too many = a slaughterhouse (no slack
// for later phases to build trade/aid on). Either failure should redden this gate loudly.
import { describe, it, expect } from 'vitest';
import { runHeadless } from '../src/orchestrator/harness.js';

describe('balance', () => {
  it('at seed 42 over 5,000 ticks, deaths land in [3, 14] — neither nursery nor slaughterhouse', async () => {
    const r = await runHeadless(42, 5000);
    expect(r.dead).toBeGreaterThanOrEqual(3);
    expect(r.dead).toBeLessThanOrEqual(14);
  });
});
