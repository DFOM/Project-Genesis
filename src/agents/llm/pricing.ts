// Per-model prices, USD per MILLION tokens. The single source of truth for what a run costs —
// both the after-the-fact meter (budget.ts) and the before-the-fact estimate (the preflight
// gate) read this table, so an estimate can never disagree with the bill.
//
// A model with no entry here is a HARD ERROR, not a $0 default: silently pricing an unknown
// model at zero would disable the budget cap for exactly the run you were least sure about.

export interface ModelPrice {
  input: number; // USD per 1M fresh input tokens
  output: number; // USD per 1M output tokens
  cacheRead: number; // USD per 1M tokens served from the prompt cache
  cacheWrite: number; // USD per 1M tokens written to the cache (5m TTL)
}

export const PRICES: Record<string, ModelPrice> = {
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // The test double is free. Listed explicitly so the mock path exercises the real pricing code
  // (rather than bypassing it) while costing exactly $0.
  mock: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

export function priceOf(model: string): ModelPrice {
  const p = PRICES[model];
  if (!p) throw new Error(`no price for model '${model}' — add it to pricing.ts before running (a missing price would silently disable the budget cap)`);
  return p;
}

export function costUSD(model: string, usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number {
  const p = priceOf(model);
  return (
    (usage.inputTokens * p.input + usage.outputTokens * p.output + usage.cacheReadTokens * p.cacheRead + usage.cacheWriteTokens * p.cacheWrite) / 1_000_000
  );
}
