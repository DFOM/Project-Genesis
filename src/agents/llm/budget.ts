// Money. Two independent defenses, in this order:
//
//   1. PREFLIGHT GATE (estimateRun + assertAffordable) — refuses to START a run whose projected
//      cost exceeds the cap. This is the first line and the important one: a 60-run batch must
//      never begin spending before the projected total has been on screen. Overridden only by an
//      explicit, deliberate --confirm-cost.
//   2. MID-RUN CAP (CostMeter) — pauses a run that is already spending once actuals cross the
//      cap. This is the backstop for when the estimate was wrong, not the primary control.
//
// A cap that only fires mid-run is a smoke alarm with no fire escape: by the time it trips, the
// money is gone. Hence the gate.
import { costUSD, priceOf } from './pricing.js';
import type { Usage } from './provider.js';

// ── 2) mid-run actuals ───────────────────────────────────────────────────────
export class CostMeter {
  private total = 0;
  private calls = 0;
  readonly capUSD: number;

  constructor(capUSD: number) {
    this.capUSD = capUSD;
  }

  // Record one call's actual cost. Returns that call's cost so the caller can put it in the record.
  add(model: string, usage: Usage): number {
    const c = costUSD(model, usage);
    this.total += c;
    this.calls += 1;
    return c;
  }

  get totalUSD(): number {
    return this.total;
  }

  get callCount(): number {
    return this.calls;
  }

  // The sim pauses (does not crash) when this goes true — a half-finished run is still data, and
  // its event log is still a complete, replayable history up to the pause.
  exceeded(): boolean {
    return this.total >= this.capUSD;
  }
}

// ── 1) preflight estimate ────────────────────────────────────────────────────
export interface EstimateInput {
  agents: number;
  ticks: number;
  runs: number; // seeds × replicates
  thinkRate: number; // 1.0 for every-tick; < 1 when urgency-gated
  model: string;
  // Token shape of one call. Defaults below are measured against the real rendered prompt in
  // test; they are an estimate, and the estimate is allowed to be wrong — that is what the
  // mid-run cap is for.
  inputTokensPerCall?: number;
  cachedTokensPerCall?: number;
  outputTokensPerCall?: number;
}

export interface Estimate {
  callsPerRun: number;
  totalCalls: number;
  costPerRunUSD: number;
  totalUSD: number;
  model: string;
}

// Defaults reflect the Phase-3 prompt: a ~600-token system prompt that is stable across ticks
// (so it is a cache READ after the first call of a run), a compact per-tick perception, and a
// tiny JSON action out.
const DEFAULT_FRESH_INPUT = 100;
const DEFAULT_CACHED_INPUT = 600;
const DEFAULT_OUTPUT = 80;

export function estimateRun(i: EstimateInput): Estimate {
  priceOf(i.model); // fail loudly NOW on an unpriced model, not after the batch starts
  const callsPerRun = Math.round(i.agents * i.ticks * i.thinkRate);
  const per = costUSD(i.model, {
    inputTokens: i.inputTokensPerCall ?? DEFAULT_FRESH_INPUT,
    cacheReadTokens: i.cachedTokensPerCall ?? DEFAULT_CACHED_INPUT,
    outputTokens: i.outputTokensPerCall ?? DEFAULT_OUTPUT,
    cacheWriteTokens: 0,
  });
  const costPerRunUSD = per * callsPerRun;
  return { callsPerRun, totalCalls: callsPerRun * i.runs, costPerRunUSD, totalUSD: costPerRunUSD * i.runs, model: i.model };
}

export function formatEstimate(e: Estimate, capUSD: number): string {
  return [
    'PREFLIGHT COST ESTIMATE',
    `  model:          ${e.model}`,
    `  calls/run:      ${e.callsPerRun.toLocaleString()}`,
    `  total calls:    ${e.totalCalls.toLocaleString()}`,
    `  cost/run:       $${e.costPerRunUSD.toFixed(2)}`,
    `  PROJECTED TOTAL: $${e.totalUSD.toFixed(2)}`,
    `  budget cap:     $${capUSD.toFixed(2)}`,
  ].join('\n');
}

export class BudgetRefused extends Error {}

// The gate. Throws unless the projected total fits the cap or the operator explicitly confirmed.
export function assertAffordable(e: Estimate, capUSD: number, confirmed: boolean): void {
  if (e.totalUSD <= capUSD || confirmed) return;
  throw new BudgetRefused(
    `${formatEstimate(e, capUSD)}\n\nREFUSED: projected $${e.totalUSD.toFixed(2)} exceeds the cap of $${capUSD.toFixed(2)}.\n` +
      `Nothing has been spent. Either raise --budget, shrink the run (--ticks / --seeds / --replicates),\n` +
      `or pass --confirm-cost to spend this deliberately.`,
  );
}
