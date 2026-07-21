// THE PROOF THAT NOTHING PAID FOR IS LOST.
//
// llm.jsonl stores each prompt as a content hash instead of 2.7 KB of text. That is only
// legitimate if the prompt is genuinely recoverable — otherwise it is a clever-sounding way of
// deleting the most expensive data in the project. These tests reconstruct EVERY prompt of a run
// from the event log and assert it matches the original byte for byte.
//
// If this file ever goes red, the hash strategy is invalid and the runner must switch to
// persist-all before any paid batch. 1.2 GB is trivial against $1,920; unrecoverable data is not.
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockProvider, type LlmCallRecord } from '../src/agents/llm/index.js';
import { InMemoryEventStore } from '../src/store/index.js';
import { runLlm } from '../src/orchestrator/llmHeadless.js';
import { hashPrompt, splitPrompt, toPersisted, writeRunArtifacts } from '../src/orchestrator/persist.js';
import { loadRun, rebuildPrompt, verifyAll, worldAtTick } from '../src/orchestrator/promptDeref.js';

// Run a small mock world, capturing the EXACT prompt sent on every call so we can compare
// reconstructions against ground truth rather than against ourselves.
async function runAndPersist(ticks = 30, agentCount = 4): Promise<{ dir: string; sent: Map<string, string>; calls: LlmCallRecord[] }> {
  const sentByCall: string[] = [];
  let n = 0;
  const provider = new MockProvider((req) => {
    sentByCall.push(`${req.system}\n\n---\n\n${req.user}`);
    n++;
    // Vary behaviour so memory fills with gathers, moves and rejections — a prompt with a rich
    // memory section is the one that would expose a reconstruction bug.
    if (n % 11 === 0) return 'not json at all';
    if (n % 3 === 0) return '{"action":{"type":"GATHER"}}';
    if (n % 4 === 0) return '{"action":{"type":"MOVE","dir":"S"}}';
    return '{"action":{"type":"REST"}}';
  });
  const store = new InMemoryEventStore();
  const runId = 'rt';
  await runLlm({ seed: 42, ticks, agentCount, provider, budgetCapUSD: 5, thinkPolicy: 'every-tick', store, runId });
  const calls = store.readLlmCalls(runId).map((r) => JSON.parse(r.payload) as LlmCallRecord);
  const dir = mkdtempSync(join(tmpdir(), 'genesis-persist-'));
  writeRunArtifacts(dir, store.read(runId), calls);
  const sent = new Map<string, string>();
  calls.forEach((c, i) => sent.set(c.callRef, sentByCall[i]!));
  return { dir, sent, calls };
}

describe('persistence — the prompt is recoverable, not discarded', () => {
  it('rebuilds EVERY prompt from the event log, byte-identical to what was sent', async () => {
    const { dir, sent } = await runAndPersist();
    const { events, calls, system } = loadRun(dir);
    expect(calls.length).toBeGreaterThan(50);

    for (const c of calls) {
      const { prompt, ok } = rebuildPrompt(events, system, c);
      expect(ok, `hash mismatch for ${c.callRef}`).toBe(true);
      // The real assertion: not just "a hash matched" but "this is the exact text we sent".
      expect(prompt, `rebuilt prompt differs for ${c.callRef}`).toBe(sent.get(c.callRef));
    }
  });

  it('stores the response and token usage IN FULL — those are the model\'s, not recomputable', async () => {
    const { dir, calls: original } = await runAndPersist();
    const { calls } = loadRun(dir);
    for (let i = 0; i < calls.length; i++) {
      expect(calls[i]!.response).toBe(original[i]!.response);
      expect(calls[i]!.usage).toEqual(original[i]!.usage);
      expect(calls[i]!.costUSD).toBe(original[i]!.costUSD);
      expect(calls[i]!.stopReason).toBe(original[i]!.stopReason);
      expect(calls[i]!.parseOk).toBe(original[i]!.parseOk);
    }
  });

  it('keeps every REASONED trace — the phase\'s actual product', async () => {
    const { dir, calls: original } = await runAndPersist();
    const { events } = loadRun(dir);
    const reasoned = events.filter((e) => e.type === 'REASONED');
    expect(reasoned).toHaveLength(original.length); // one trace per call, none dropped
    const refs = new Set(reasoned.map((e) => (e as { callRef: string }).callRef));
    for (const c of original) expect(refs.has(c.callRef)).toBe(true);
  });

  it('reconstructs the world at the tick the prompt was rendered — not one tick late', async () => {
    const { dir } = await runAndPersist();
    const { events, calls } = loadRun(dir);
    // The prompt for tick t was rendered BEFORE tick t's events existed. Off-by-one here would
    // rebuild a prompt containing the consequences of the very action it was about to propose.
    for (const t of [0, 1, 7, 20]) {
      const w = worldAtTick(events, t);
      expect(w.tick).toBe(t);
    }
    const first = calls.find((c) => c.tick === 0)!;
    expect(worldAtTick(events, first.tick).tick).toBe(0);
  });

  it('verifyAll (the O(n) single-pass audit) agrees with the per-call rebuild', async () => {
    const { dir } = await runAndPersist();
    const { events, calls, system } = loadRun(dir);
    const v = verifyAll(events, system, calls);
    expect(v.ok).toBe(calls.length);
    expect(v.bad).toHaveLength(0);
    // Same verdict as the slow path, on every call — the optimisation must not change the answer.
    for (const c of calls) expect(rebuildPrompt(events, system, c).ok).toBe(true);
  });

  it('verifyAll flags drift instead of reporting a clean bill', async () => {
    const { dir } = await runAndPersist();
    const { events, calls, system } = loadRun(dir);
    const v = verifyAll(events, system + '\nEXTRA', calls);
    expect(v.ok).toBe(0);
    expect(v.bad).toHaveLength(calls.length);
  });

  it('detects a tampered/drifted prompt rather than silently trusting it', async () => {
    const { dir } = await runAndPersist();
    const { events, calls, system } = loadRun(dir);
    // Simulate prompt.ts having changed since the run: the system half differs.
    const drifted = rebuildPrompt(events, system + '\nEXTRA RULE', calls[0]!);
    expect(drifted.ok).toBe(false); // loud, not silent
  });

  it('stores the system prompt once, not once per call', async () => {
    const { dir, calls } = await runAndPersist();
    const onDisk = readFileSync(join(dir, 'system-prompt.txt'), 'utf8').replace(/\n$/, '');
    expect(onDisk).toBe(splitPrompt(calls[0]!.prompt).system);
    // llm.jsonl must not contain the system prompt text at all — that is the whole saving.
    const llm = readFileSync(join(dir, 'llm.jsonl'), 'utf8');
    expect(llm).not.toContain('YOUR ACTIONS — choose exactly one per turn');
  });

  it('the hash is over the exact prompt bytes', () => {
    const r = { prompt: 'hello world' } as LlmCallRecord;
    expect(toPersisted({ ...r, callRef: 'x', tick: 0, agentId: 'a', provider: 'p', model: 'm', response: '', usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, costUSD: 0, latencyMs: 0, stopReason: 'end_turn', parseOk: true }).promptHash).toBe(hashPrompt('hello world'));
  });
});
