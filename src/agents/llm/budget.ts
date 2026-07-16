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

// MEASURED against the real rendered prompt (seed 42, 6 agents, 300 samples over 50 ticks), not
// guessed:
//   system prompt      542 tokens  (stable across every call of a run)
//   per-tick perception mean 147, p50 137, p95 212 tokens
//   action out         ~40 tokens of JSON
//
// NOTHING IS CACHED, AND THAT IS NOT A BUG WE CAN FIX. Opus 4.8's minimum cacheable prefix is
// 4,096 tokens; our system prompt is 542. Below the minimum the API silently declines to cache —
// no error, `cache_creation_input_tokens: 0` — so `cache_control` in anthropic.ts is inert and
// every call pays full input price for all 542 tokens. Padding the prompt to 4,096 tokens to
// "unlock" caching would mean inventing ~3,500 tokens of filler to read on every call: it barely
// breaks even and it would corrupt the experiment, since the system prompt IS the treatment.
//
// So the defaults below assume ZERO cache reads. An earlier version assumed 600 cached tokens at
// the $0.50/M cache rate and under-priced the whole project by ~59% ($1,210 vs $1,920 for the
// success matrix) — an error that would have surfaced as a budget pause halfway through a paid
// batch rather than as a number on screen beforehand. The estimate is the gate; the gate has to
// be honest or it is decoration.
const DEFAULT_FRESH_INPUT = 542 + 147; // system + mean perception, all at full price
const DEFAULT_CACHED_INPUT = 0;
const DEFAULT_OUTPUT = 40;

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
