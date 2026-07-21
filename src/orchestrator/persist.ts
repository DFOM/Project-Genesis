// What a paid run leaves behind. One writer, used by both `sim:smoke` and `npm run research`, so
// a $1.33 test and a $1,920 batch produce byte-identical artifact shapes and the same reader works
// on both.
//
// THE RULE: discarding paid data is the only unrecoverable error. A run can be re-analysed, re-
// charted, re-interpreted for years — but only if it was kept. Mortality counts are a summary of
// the experiment; the reasoning traces ARE the experiment.
//
// ── What we write ─────────────────────────────────────────────────────────────
//   events.jsonl       the full event log — including every REASONED, verbatim. This is also the
//                      substrate that makes prompt reconstruction possible (below).
//   llm.jsonl          one record per call: response IN FULL, usage IN FULL, cost, latency, and
//                      the prompt as a CONTENT HASH.
//   system-prompt.txt  the system half of every prompt in the run — identical across all calls, so
//                      it is stored once instead of 7,200 times.
//
// ── Why the prompt is a hash, not a copy ──────────────────────────────────────
// The prompt is a *deterministic function of state we already keep*:
//
//     prompt(t, agent) = system + renderPerception(perceive(replay(events, t), agent))
//
// Replaying events.jsonl to tick t reconstructs the world exactly — memory included, because
// memory is event-sourced through the same reducer. So storing the prompt verbatim would be
// storing a derived value: ~2.7 KB × 432,000 calls ≈ 1.2 GB of recomputable text.
//
// The hash is not a space trick, it is an INTEGRITY CLAIM. Reconstruction that reproduces the
// hash proves the reconstruction is faithful. Reconstruction that does not proves something
// drifted — and silently trusting a mismatched replay would be worse than not keeping the prompt
// at all. `npm run sim:prompt` is the dereference, and it verifies rather than assumes.
//
// ── The caveat this buys, stated plainly ──────────────────────────────────────
// Reconstruction depends on the CODE that rendered it: change prompt.ts or perceive.ts and the
// replay yields a different string and the hash mismatches. That is why every run stamps its git
// SHA. To read a prompt from an old run, check out its SHA. The mismatch is a feature — it is the
// system telling you the truth instead of handing you a plausible-looking lie.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Event } from '../engine/index.js';
import type { LlmCallRecord } from '../agents/llm/index.js';

export const PROMPT_SEPARATOR = '\n\n---\n\n'; // must match llmMind.ts's prompt assembly

export function hashPrompt(prompt: string): string {
  return `sha256:${createHash('sha256').update(prompt, 'utf8').digest('hex')}`;
}

// The persisted form of an LLM call. Everything the model produced is kept verbatim; only the
// prompt — the one field that is recomputable — is replaced by its hash.
export interface PersistedLlmCall {
  callRef: string; // joins to the REASONED event in events.jsonl
  tick: number;
  agentId: string;
  provider: string;
  model: string;
  promptHash: string; // dereference: npm run sim:prompt -- --dir <dir> --callref <callRef>
  promptBytes: number; // what the hash stands in for — lets you audit size without rebuilding
  response: string; // IN FULL
  usage: LlmCallRecord['usage']; // IN FULL
  costUSD: number;
  latencyMs: number;
  stopReason: string;
  parseOk: boolean;
}

export function toPersisted(r: LlmCallRecord): PersistedLlmCall {
  return {
    callRef: r.callRef,
    tick: r.tick,
    agentId: r.agentId,
    provider: r.provider,
    model: r.model,
    promptHash: hashPrompt(r.prompt),
    promptBytes: Buffer.byteLength(r.prompt, 'utf8'),
    response: r.response,
    usage: r.usage,
    costUSD: r.costUSD,
    latencyMs: r.latencyMs,
    stopReason: r.stopReason,
    parseOk: r.parseOk,
  };
}

// Split a stored prompt back into its halves. The system half is constant per run and lives in
// system-prompt.txt; the user half is what replay regenerates.
export function splitPrompt(prompt: string): { system: string; user: string } {
  const i = prompt.indexOf(PROMPT_SEPARATOR);
  if (i < 0) return { system: '', user: prompt };
  return { system: prompt.slice(0, i), user: prompt.slice(i + PROMPT_SEPARATOR.length) };
}

export interface RunArtifacts {
  eventsPath: string;
  llmPath: string;
  events: number;
  reasoned: number;
  calls: number;
  bytes: number;
  promptBytesElided: number; // what the hash saved — reported, so the trade is visible
}

// Write one run's artifacts. `dir` is the run's own directory.
export function writeRunArtifacts(dir: string, events: readonly Event[], calls: readonly LlmCallRecord[]): RunArtifacts {
  mkdirSync(dir, { recursive: true });
  const eventsPath = join(dir, 'events.jsonl');
  const llmPath = join(dir, 'llm.jsonl');

  const eventsText = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
  writeFileSync(eventsPath, eventsText);

  const persisted = calls.map(toPersisted);
  const llmText = persisted.map((c) => JSON.stringify(c)).join('\n') + '\n';
  writeFileSync(llmPath, llmText);

  // The system prompt is identical on every call of a run — store it once, not 7,200 times.
  // It is the other half of every reconstruction.
  if (calls.length > 0) writeFileSync(join(dir, 'system-prompt.txt'), splitPrompt(calls[0]!.prompt).system + '\n');

  // What the hash actually saved: every prompt's bytes, less the system half we DO keep (once).
  // Subtracting a whole first prompt here would quietly understate it — the file on disk holds
  // only the system half, not the tick-0 perception.
  const systemBytes = calls.length > 0 ? Buffer.byteLength(splitPrompt(calls[0]!.prompt).system, 'utf8') : 0;
  return {
    eventsPath,
    llmPath,
    events: events.length,
    reasoned: events.filter((e) => e.type === 'REASONED').length,
    calls: calls.length,
    bytes: Buffer.byteLength(eventsText, 'utf8') + Buffer.byteLength(llmText, 'utf8') + systemBytes,
    promptBytesElided: persisted.reduce((a, c) => a + c.promptBytes, 0) - systemBytes,
  };
}
