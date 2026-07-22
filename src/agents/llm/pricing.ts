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

// OpenAI standard-tier published rates (USD / 1M tokens), verified against OpenAI's model pages.
// `cacheRead` is OpenAI's cached-input price; `cacheWrite` is 0 because OpenAI auto-caches with no
// write premium (unlike Anthropic). Our ~689-token prompt is below OpenAI's 1,024-token auto-cache
// threshold, so cacheRead is never actually exercised on this loop — but priced correctly in case.
//
// WHY THE DATED SNAPSHOTS ARE HERE, not just the aliases: OpenAI resolves an alias like `gpt-4o` to
// a dated snapshot (`gpt-4o-2024-08-06`, `gpt-4o-2024-11-20`, …) and returns THAT id in the
// response. The meter prices against the returned id (see llmMind), so a run that requests `gpt-4o`
// bills under whichever snapshot the account resolves to. Every gpt-4o snapshot shares one rate, so
// they alias the same object — no chance of two snapshots silently drifting apart in this table.
const GPT_4O: ModelPrice = { input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 };
const GPT_4O_MINI: ModelPrice = { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0 };

export const PRICES: Record<string, ModelPrice> = {
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  'claude-sonnet-5': { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  // gpt-4o alias + its dated snapshots (all one rate).
  'gpt-4o': GPT_4O,
  'gpt-4o-2024-08-06': GPT_4O, // deprecated snapshot, but still what some accounts resolve `gpt-4o` to
  'gpt-4o-2024-11-20': GPT_4O, // current default snapshot for `gpt-4o`
  // gpt-4o-mini alias + its dated snapshot.
  'gpt-4o-mini': GPT_4O_MINI,
  'gpt-4o-mini-2024-07-18': GPT_4O_MINI,
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
