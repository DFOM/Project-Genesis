// THE LIVE SMOKE TEST — the first real API call this project ever makes.
//
//   npm run sim:smoke -- --seed 42 --agents 6 --ticks 50 --budget 3
//
// Small, budgeted, and deliberate. It answers the questions a mock cannot:
//   • do real responses parse, or does the model talk its way around the schema?
//   • is the cost model right? (it prints preflight vs ACTUAL, per token class)
//   • what did it actually think? (the REASONED log is written to disk, verbatim)
//
// WHY THIS EXISTS SEPARATELY FROM `npm run research`: the research runner keeps aggregates —
// runs.csv, summary.md — and drops the event log when the run ends. That is fine for charting
// mortality across 60 runs; it is useless for reading a mind. This command persists the full
// event log AND the LLM-call sidecar as JSONL, because on the first live run the transcript IS
// the result.
//
// It spends real money. It refuses to start over budget (--confirm-cost to override), and the
// mid-run cap remains the backstop.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnthropicProvider, assertAffordable, envKeyProvider, estimateRun, formatEstimate, type LlmCallRecord } from '../agents/llm/index.js';
import { InMemoryEventStore } from '../store/index.js';
import { runLlm } from './llmHeadless.js';

function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}
const hasFlag = (n: string): boolean => process.argv.includes(`--${n}`);

function die(err: unknown): never {
  process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n\n`);
  process.exit(1);
}

async function main(): Promise<void> {
  const seed = Number(argVal('seed') ?? '42');
  const agents = Number(argVal('agents') ?? '6');
  const ticks = Number(argVal('ticks') ?? '50');
  const model = argVal('model') ?? 'claude-opus-4-8';
  const budget = Number(argVal('budget') ?? '0');
  if (!(budget > 0)) throw new Error('--budget <USD> is required. There is no default for a command that spends money.');

  // ── the gate: nothing is spent before this passes ──────────────────────────
  const est = estimateRun({ agents, ticks, runs: 1, thinkRate: 1, model });
  process.stderr.write(`${formatEstimate(est, budget)}\n\n`);
  assertAffordable(est, budget, hasFlag('confirm-cost'));

  const provider = new AnthropicProvider({ model, keys: envKeyProvider() });
  const store = new InMemoryEventStore();
  const runId = `smoke-${seed}`;
  process.stderr.write(`LIVE: ${agents} agents × ${ticks} ticks × seed ${seed} (${model}) — spending up to $${budget.toFixed(2)}\n\n`);

  const started = Date.now();
  const r = await runLlm({ seed, ticks, agentCount: agents, provider, budgetCapUSD: budget, thinkPolicy: 'every-tick', store, runId });
  const wallMs = Date.now() - started;

  // ── persist everything: the transcript IS the result ───────────────────────
  const outDir = join('research', `smoke-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(outDir, { recursive: true });
  const events = store.read(runId);
  const calls = store.readLlmCalls(runId).map((row) => JSON.parse(row.payload) as LlmCallRecord);
  writeFileSync(join(outDir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  writeFileSync(join(outDir, 'llm.jsonl'), calls.map((c) => JSON.stringify(c)).join('\n') + '\n');

  // ── preflight vs ACTUAL, per token class — this is what corrects the model ──
  const sum = (f: (c: LlmCallRecord) => number): number => calls.reduce((a, c) => a + f(c), 0);
  const actualIn = sum((c) => c.usage.inputTokens);
  const actualOut = sum((c) => c.usage.outputTokens);
  const actualRead = sum((c) => c.usage.cacheReadTokens);
  const actualWrite = sum((c) => c.usage.cacheWriteTokens);
  const n = Math.max(1, calls.length);

  const L: string[] = [];
  L.push('');
  L.push('PREFLIGHT vs ACTUAL');
  L.push(`  calls:          predicted ${est.callsPerRun}    actual ${calls.length}`);
  L.push(`  cost:           predicted $${est.totalUSD.toFixed(4)}    actual $${r.costUSD.toFixed(4)}    ${r.costUSD > 0 ? `(${(((r.costUSD - est.totalUSD) / est.totalUSD) * 100).toFixed(1)}% vs estimate)` : ''}`);
  L.push('');
  L.push('  per call, measured:');
  L.push(`    fresh input   ${(actualIn / n).toFixed(0)} tok    (estimator assumes 689)`);
  L.push(`    output        ${(actualOut / n).toFixed(0)} tok    (estimator assumes 40)`);
  L.push(`    cache read    ${(actualRead / n).toFixed(0)} tok    (estimator assumes 0)`);
  L.push(`    cache write   ${(actualWrite / n).toFixed(0)} tok`);
  L.push('');
  // The cache claim, settled by evidence rather than by reading the docs.
  L.push(
    actualRead === 0
      ? '  CACHE: 0 read tokens across every call — confirms the system prompt (~542 tok) is below'
      : `  CACHE: ${actualRead} read tokens — the prompt IS caching; budget.ts defaults need updating`,
  );
  if (actualRead === 0) L.push("        Opus 4.8's 4,096-token minimum. cache_control is inert, as budget.ts assumes.");
  L.push('');
  L.push('RUN');
  L.push(`  ticks completed:     ${r.report.ticks}/${ticks}${r.budgetPaused ? '  ← BUDGET PAUSED' : ''}`);
  L.push(`  agents:              ${r.report.alive} alive / ${r.report.dead} dead`);
  L.push(`  modelActionFraction: ${r.modelActionFraction}`);
  L.push(`  wall clock:          ${(wallMs / 1000).toFixed(1)}s  (${(wallMs / Math.max(1, calls.length)).toFixed(0)} ms/call)`);
  L.push('');
  // Did the real model actually obey the schema? The mock could never tell us.
  const bad = calls.filter((c) => !c.parseOk);
  L.push(`PARSING: ${calls.length - bad.length}/${calls.length} responses parsed to a valid action (${((1 - bad.length / n) * 100).toFixed(1)}%)`);
  if (bad.length > 0) {
    const byStop = new Map<string, number>();
    for (const c of bad) byStop.set(c.stopReason, (byStop.get(c.stopReason) ?? 0) + 1);
    for (const [k, v] of byStop) L.push(`  ${v} × stop_reason=${k}`);
  }
  const rejected = events.filter((e) => e.type === 'ACTION_REJECTED');
  L.push(`REJECTIONS: ${rejected.length} (the referee biting — expected and healthy)`);
  L.push('');
  L.push(`WROTE → ${outDir}`);
  L.push(`  events.jsonl  ${events.length} events (incl. ${events.filter((e) => e.type === 'REASONED').length} REASONED — what it thought, verbatim)`);
  L.push(`  llm.jsonl     ${calls.length} call records (prompt, usage, cost)`);
  L.push('');
  L.push(`Read a mind:  npm run sim:reasoning -- --dir ${outDir}`);
  process.stdout.write(L.join('\n') + '\n');

  writeFileSync(
    join(outDir, 'config.json'),
    JSON.stringify({ seed, agents, ticks, model, budget, thinkPolicy: 'every-tick', estimateUSD: est.totalUSD, actualUSD: r.costUSD, calls: calls.length, wallMs, budgetPaused: r.budgetPaused }, null, 2) + '\n',
  );
}

void main().catch(die);
