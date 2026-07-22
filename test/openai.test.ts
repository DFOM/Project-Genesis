// OpenAI adapter — the parts testable without a network call: the exact request it builds, and its
// pricing. `complete()` itself needs a live client, so it is exercised by the smoke test, not here.
import { describe, it, expect } from 'vitest';
import { openaiRequestParams, costUSD, PRICES, priceOf, estimateRun, MockProvider, NO_RETRY } from '../src/agents/llm/index.js';
import { runLlm } from '../src/orchestrator/llmHeadless.js';

const REST = '{"action":{"type":"REST"}}';
const noSleep = async (): Promise<void> => {};

describe('openai request params', () => {
  it('sends system+user messages, max_completion_tokens (not the deprecated max_tokens), and no schema', () => {
    const p = openaiRequestParams({ system: 'SYS', user: 'USR', maxTokens: 512 }, 'gpt-4o-mini');
    expect(p.model).toBe('gpt-4o-mini');
    expect(p.max_completion_tokens).toBe(512);
    expect('max_tokens' in p).toBe(false); // deprecated field must not be sent
    expect(p.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USR' },
    ]);
    // Text-in/text-out: no response_format / structured-output schema on the request.
    expect('response_format' in p).toBe(false);
  });
});

describe('openai pricing', () => {
  it('prices gpt-4o and gpt-4o-mini (a run against an unpriced model must fail loudly, not default to $0)', () => {
    expect(priceOf('gpt-4o')).toEqual({ input: 2.5, output: 10, cacheRead: 1.25, cacheWrite: 0 });
    expect(PRICES['gpt-4o-mini']!.input).toBe(0.15);
    expect(() => priceOf('gpt-5-imaginary')).toThrow(/no price/);
  });

  it('per-call cost matches the hand arithmetic (689 in / 40 out, no cache)', () => {
    const usage = { inputTokens: 689, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 };
    // gpt-4o: (689*2.5 + 40*10)/1e6 = 2122.5/1e6
    expect(costUSD('gpt-4o', usage)).toBeCloseTo(0.0021225, 9);
    // gpt-4o-mini: (689*0.15 + 40*0.6)/1e6 = 127.35/1e6
    expect(costUSD('gpt-4o-mini', usage)).toBeCloseTo(0.00012735, 9);
  });

  it('the preflight estimator uses OpenAI rates for an OpenAI model', () => {
    const e4o = estimateRun({ agents: 6, ticks: 50, runs: 1, thinkRate: 1, model: 'gpt-4o' });
    const eMini = estimateRun({ agents: 6, ticks: 50, runs: 1, thinkRate: 1, model: 'gpt-4o-mini' });
    expect(e4o.callsPerRun).toBe(300);
    expect(e4o.totalUSD).toBeCloseTo(0.6368, 3); // ~$0.64 for the smoke test
    expect(eMini.totalUSD).toBeCloseTo(0.0382, 3); // ~$0.04
    expect(eMini.totalUSD).toBeLessThan(e4o.totalUSD);
  });

  it('prices dated snapshots identically to their alias — the RETURNED id is billable', () => {
    // OpenAI returns e.g. gpt-4o-2024-08-06 when you ask for gpt-4o; every snapshot shares one rate.
    expect(priceOf('gpt-4o-2024-08-06')).toEqual(priceOf('gpt-4o'));
    expect(priceOf('gpt-4o-2024-11-20')).toEqual(priceOf('gpt-4o'));
    expect(priceOf('gpt-4o-mini-2024-07-18')).toEqual(priceOf('gpt-4o-mini'));
  });
});

// ── the hard-refuse: an unpriced id must THROW, never resolve to $0 ────────────
// $0 is the dangerous value — it would silently disable the budget cap for exactly the run whose
// model we were least sure about. Both the pre-flight estimator (requested id) and the runtime
// meter (returned id) must refuse loudly.
describe('unpriced model hard-refuses (never $0)', () => {
  const usage = { inputTokens: 1000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0 };

  it('costUSD throws on an unknown returned id and does NOT return 0', () => {
    expect(() => costUSD('gpt-4o-2099-99-99', usage)).toThrow(/no price/);
    let out: number | 'threw' = -1;
    try {
      out = costUSD('some-unlisted-model', usage);
    } catch {
      out = 'threw';
    }
    expect(out).toBe('threw'); // the crucial assertion: it threw rather than returning 0
  });

  it('the estimator throws on an unknown requested model, before any spend', () => {
    expect(() => estimateRun({ agents: 6, ticks: 50, runs: 1, thinkRate: 1, model: 'totally-unknown-model' })).toThrow(/no price/);
  });
});

// ── resolution round-trip: request an alias, receive a snapshot, price the snapshot ───
describe('alias → snapshot resolution', () => {
  it('requesting gpt-4o and getting gpt-4o-2024-08-06 back prices at the gpt-4o rate', async () => {
    const usage = { inputTokens: 689, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 };
    // We construct the provider as 'gpt-4o' but the "API" returns the resolved dated snapshot id.
    const provider = new MockProvider(() => ({ text: REST, model: 'gpt-4o-2024-08-06', usage }), 'gpt-4o');
    const r = await runLlm({ seed: 42, ticks: 2, agentCount: 3, provider, budgetCapUSD: 5, thinkPolicy: 'every-tick', retry: NO_RETRY, sleep: noSleep });
    // Billed under the RESOLVED id's rate (which equals gpt-4o's), one charge per call.
    expect(r.costUSD).toBeCloseTo(costUSD('gpt-4o', usage) * r.llmCalls, 9);
    expect(r.costUSD).toBeGreaterThan(0);
  });

  it('the cap trips based on the RESOLVED model price, not the requested alias', async () => {
    const usage = { inputTokens: 100_000, outputTokens: 100_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const provider = new MockProvider(() => ({ text: REST, model: 'gpt-4o-2024-08-06', usage }), 'gpt-4o');
    const r = await runLlm({ seed: 42, ticks: 500, agentCount: 4, provider, budgetCapUSD: 0.5, thinkPolicy: 'every-tick', retry: NO_RETRY, sleep: noSleep });
    expect(r.budgetPaused).toBe(true);
    expect(r.report.ticks).toBeLessThan(500); // stopped early because the resolved id was priced
  });
});
