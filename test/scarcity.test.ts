// PERMANENT SCARCITY GATE. Mortality alone is a bad proxy for a scarce world — you can keep
// the death count "healthy" while quietly turning the map back into a paradise (infinite
// supply, no contest). This locks scarcity in as a measurable property: nodes must actually
// run dry, and gathers must actually be contested. Kept separate from determinism/balance so
// a future tuning that erases scarcity reddens THIS gate loudly.
import { describe, it, expect } from 'vitest';
import { diagnose } from '../src/orchestrator/diagnostics.js';

describe('scarcity', () => {
  it('at seed 42, nodes deplete and gathers are contested', async () => {
    const r = await diagnose(42, 5000);
    // Nodes actually run dry (trough at zero) — measured ≈0.5% of node-ticks; a paradise is 0%.
    expect(r.nodeZeroFraction).toBeGreaterThan(0.002);
    // Agents repeatedly ARRIVE at an emptied node — measured ≈3500; a paradise is 0.
    expect(r.rejections['nothing to gather here'] ?? 0).toBeGreaterThan(1000);
    // The seeded shuffle actually decides who gets a contested last unit — measured ≈380; paradise 0.
    expect(r.lastUnitDecisions).toBeGreaterThan(150);
  });
});
