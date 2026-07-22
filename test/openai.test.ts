// OpenAI adapter — the parts testable without a network call: the exact request it builds, and its
// pricing. `complete()` itself needs a live client, so it is exercised by the smoke test, not here.
import { describe, it, expect } from 'vitest';
import { openaiRequestParams, costUSD, PRICES, priceOf, estimateRun } from '../src/agents/llm/index.js';

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
});
