// THE "RESULTS EVEN IF INCOMPLETE" GUARANTEE, proven with MockProvider ($0, no network).
//
// The promise: a run that stops early — budget cap, provider error, a thrown exception mid-run —
// leaves everything completed so far on disk, complete and readable. And one bad call never kills
// the run: a provider/parse failure on one agent becomes an INVALID → rejection, the tick finishes,
// the run rolls on. These tests hold the code to exactly that.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { httpError, isRetryable, MockProvider, NO_RETRY, withRetry } from '../src/agents/llm/index.js';
import { runLlm } from '../src/orchestrator/llmHeadless.js';
import { loadRun } from '../src/orchestrator/promptDeref.js';
import type { Event } from '../src/engine/index.js';

const REST = '{"action":{"type":"REST"}}';
const tmp = (): string => mkdtempSync(join(tmpdir(), 'genesis-resil-'));
// Instant retries in tests — no real backoff waiting.
const noSleep = async (): Promise<void> => {};

function readEvents(dir: string): Event[] {
  return readFileSync(join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Event);
}

// ── incremental persistence: an early stop still leaves a complete log ─────────
describe('incremental persistence', () => {
  it('appends per tick — the file is durable and in order as the run proceeds, not written once at the end', async () => {
    const dir = tmp();
    let n = 0;
    const provider = new MockProvider(() => {
      n++;
      return REST;
    });
    await runLlm({ seed: 42, ticks: 5, agentCount: 3, provider, budgetCapUSD: 5, thinkPolicy: 'every-tick', outDir: dir, runId: 'inc', retry: NO_RETRY, sleep: noSleep });

    const events = readEvents(dir);
    expect(events[0]!.type).toBe('GENESIS'); // replay needs it first
    expect(events.filter((e) => e.type === 'TICK_COMPLETED')).toHaveLength(5);
    // The reader loads events + llm + system-prompt with no error, and the counts agree.
    const loaded = loadRun(dir);
    expect(loaded.events.length).toBe(events.length);
    expect(loaded.calls.length).toBe(n); // one persisted call per model call
  });

  it('budget cap → clean pause with a complete partial log, no crash, nothing discarded', async () => {
    const dir = tmp();
    // Charge a real price so the meter climbs; cap it absurdly low so it trips after a few calls.
    const provider = new MockProvider(() => ({ text: REST, model: 'gpt-4o', usage: { inputTokens: 100_000, outputTokens: 10_000, cacheReadTokens: 0, cacheWriteTokens: 0 } }), 'gpt-4o');
    const r = await runLlm({ seed: 42, ticks: 500, agentCount: 4, provider, budgetCapUSD: 0.02, thinkPolicy: 'every-tick', outDir: dir, runId: 'cap', retry: NO_RETRY, sleep: noSleep });
    expect(r.budgetPaused).toBe(true);
    expect(r.report.ticks).toBeLessThan(500); // stopped early
    // The partial run is COMPLETE up to the pause and readable.
    const loaded = loadRun(dir);
    expect(loaded.events[0]!.type).toBe('GENESIS');
    expect(loaded.events.some((e) => e.type === 'TICK_COMPLETED')).toBe(true);
    expect(r.artifacts!.events).toBe(loaded.events.length);
  });
});

// ── one bad call never kills the run ───────────────────────────────────────────
describe('one bad call never kills the run', () => {
  it('a provider that always 500s → every action becomes INVALID, but all ticks complete', async () => {
    const dir = tmp();
    const provider = new MockProvider(() => {
      throw httpError(500, 'internal error');
    });
    // 4 agents × 6 ticks, provider down the entire time. The run must still finish all 6 ticks.
    const r = await runLlm({ seed: 42, ticks: 6, agentCount: 4, provider, budgetCapUSD: 5, thinkPolicy: 'every-tick', outDir: dir, runId: 'down', retry: NO_RETRY, sleep: noSleep });
    expect(r.report.ticks).toBe(6);

    const events = readEvents(dir);
    const rejections = events.filter((e): e is Extract<Event, { type: 'ACTION_REJECTED' }> => e.type === 'ACTION_REJECTED');
    expect(rejections.length).toBeGreaterThan(0);
    // Every rejection here is the provider-outage INVALID, and it landed in the log as a real event.
    expect(rejections.every((e) => e.action.type === 'INVALID')).toBe(true);
    expect(rejections[0]!.reason).toBe('invalid proposal: provider unavailable');
    // Exactly one REASONED per call — retries/failures do not multiply the trace.
    const reasoned = events.filter((e) => e.type === 'REASONED');
    const calls = loadRun(dir).calls;
    expect(reasoned.length).toBe(calls.length);
    // A failed call is not billed.
    expect(r.costUSD).toBe(0);
  });

  it('some calls fail while others succeed in the SAME tick — the failure never aborts the tick', async () => {
    const dir = tmp();
    // Fail every other CALL (the prompt is blind — we can't target an agent by name, which is
    // itself the right property). Within a 4-agent tick this fails ~2 and passes ~2.
    let i = 0;
    const provider = new MockProvider(() => {
      if (i++ % 2 === 0) throw httpError(503, 'unavailable');
      return REST;
    });
    const r = await runLlm({ seed: 42, ticks: 4, agentCount: 4, provider, budgetCapUSD: 5, thinkPolicy: 'every-tick', outDir: dir, runId: 'partial', retry: NO_RETRY, sleep: noSleep });
    expect(r.report.ticks).toBe(4); // all ticks completed despite failures every tick

    const events = readEvents(dir);
    // Both outcomes coexist: provider-outage INVALIDs AND successful RESTs. A failure for one agent
    // did not prevent another from acting.
    const rested = events.filter((e) => e.type === 'RESTED');
    const invalidRej = events.filter((e): e is Extract<Event, { type: 'ACTION_REJECTED' }> => e.type === 'ACTION_REJECTED' && e.action.type === 'INVALID');
    expect(rested.length).toBeGreaterThan(0);
    expect(invalidRej.length).toBeGreaterThan(0);
  });
});

// ── retry classification + backoff ─────────────────────────────────────────────
describe('transport retry', () => {
  it('retries 429/529/5xx and connection drops; does NOT retry 4xx client errors', () => {
    for (const s of [429, 500, 502, 503, 529]) expect(isRetryable(httpError(s)), `status ${s}`).toBe(true);
    for (const s of [400, 401, 403, 404, 422]) expect(isRetryable(httpError(s)), `status ${s}`).toBe(false);
    expect(isRetryable(Object.assign(new Error('reset'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isRetryable(new Error('plain'))).toBe(false);
  });

  it('succeeds on a later attempt after transient failures', async () => {
    let attempts = 0;
    const flaky = async (): Promise<string> => {
      attempts++;
      if (attempts < 3) throw httpError(429);
      return 'ok';
    };
    const out = await withRetry(flaky, { maxAttempts: 4, baseDelayMs: 1, maxDelayMs: 1 }, noSleep);
    expect(out).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('gives up after maxAttempts and throws the last error (→ llmMind turns it into INVALID)', async () => {
    let attempts = 0;
    const dead = async (): Promise<never> => {
      attempts++;
      throw httpError(503);
    };
    await expect(withRetry(dead, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 1 }, noSleep)).rejects.toMatchObject({ status: 503 });
    expect(attempts).toBe(3); // 3 attempts, then gives up
  });

  it('does not retry a non-retryable error even once', async () => {
    let attempts = 0;
    const bad = async (): Promise<never> => {
      attempts++;
      throw httpError(401);
    };
    await expect(withRetry(bad, { maxAttempts: 5, baseDelayMs: 1, maxDelayMs: 1 }, noSleep)).rejects.toMatchObject({ status: 401 });
    expect(attempts).toBe(1);
  });
});
