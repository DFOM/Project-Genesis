// THE LIVE SMOKE TEST — the first real API call this project ever makes.
//
//   npm run sim:smoke -- --seed 42 --agents 6 --ticks 50 --budget 3
//
// Small, budgeted, and deliberate. It answers the questions a mock cannot:
//   • do real responses parse, or does the model talk its way around the schema?
//   • is the cost model right? (it prints preflight vs ACTUAL, per token class)
//   • what did it actually think? (the REASONED log is written to disk, verbatim)
//
// WHY THIS EXISTS SEPARATELY FROM `npm run research`: not persistence — the runner now keeps
// per-run event logs and call records too, via the same writer (persist.ts). This is the
// SINGLE-RUN, first-contact command: it prints preflight-vs-actual per token class, the schema
// obedience rate, and the cache verdict — the diagnostics you want once, cheaply, before
// committing to a 60-run batch. The runner is for the batch; this is for the first call.
//
// It spends real money. It refuses to start over budget (--confirm-cost to override), and the
// mid-run cap remains the backstop.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AnthropicProvider, OpenAIProvider, assertAffordable, envKeyProvider, estimateRun, formatEstimate, type LlmCallRecord, type LlmProvider } from '../agents/llm/index.js';
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

// Provider selection: the surgical Phase-4 slice. `anthropic` (default) or `openai`, chosen at the
// seam and nowhere else. The default model tracks the provider so `--provider openai` alone gives a
// sensible cheap model without also needing `--model`.
function makeProvider(name: string, model: string): LlmProvider {
  switch (name) {
    case 'anthropic':
      return new AnthropicProvider({ model, keys: envKeyProvider('ANTHROPIC_API_KEY') });
    case 'openai':
      return new OpenAIProvider({ model, keys: envKeyProvider('OPENAI_API_KEY') });
    default:
      throw new Error(`unknown provider '${name}'. This slice ships 'anthropic' and 'openai'.`);
  }
}

async function main(): Promise<void> {
  const seed = Number(argVal('seed') ?? '42');
  const agents = Number(argVal('agents') ?? '6');
  const ticks = Number(argVal('ticks') ?? '50');
  const providerName = argVal('provider') ?? 'anthropic';
  const model = argVal('model') ?? (providerName === 'openai' ? 'gpt-4o-mini' : 'claude-opus-4-8');
  const budget = Number(argVal('budget') ?? '0');
  if (!(budget > 0)) throw new Error('--budget <USD> is required. There is no default for a command that spends money.');

  // ── the gate: nothing is spent before this passes ──────────────────────────
  // estimateRun looks the model up in pricing.ts, so the OpenAI estimate uses OpenAI rates.
  const est = estimateRun({ agents, ticks, runs: 1, thinkRate: 1, model });
  process.stderr.write(`${formatEstimate(est, budget)}\n\n`);
  assertAffordable(est, budget, hasFlag('confirm-cost'));

  const provider = makeProvider(providerName, model);
  const store = new InMemoryEventStore();
  const runId = `smoke-${seed}`;
  // outDir is fixed BEFORE the run so persistence is incremental: if the run is killed, everything
  // completed so far is already here and readable by sim:reasoning.
  const outDir = join('research', `smoke-${providerName}-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  process.stderr.write(`LIVE: ${agents} agents × ${ticks} ticks × seed ${seed} (${providerName}/${model}) — spending up to $${budget.toFixed(2)}\n\n`);

  const started = Date.now();
  const r = await runLlm({ seed, ticks, agentCount: agents, provider, budgetCapUSD: budget, thinkPolicy: 'every-tick', store, runId, outDir });
  const wallMs = Date.now() - started;

  const events = store.read(runId);
  const calls = store.readLlmCalls(runId).map((row) => JSON.parse(row.payload) as LlmCallRecord);
  const art = r.artifacts!; // outDir was set → artifacts present

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
  // The cache claim, settled by evidence rather than by reading the docs. Both providers have a
  // minimum-cacheable-prefix threshold (Opus 4.8: 4,096 tok; OpenAI auto-cache: 1,024 tok) that our
  // ~689-token prompt sits below, so budget.ts assumes zero cache reads for both.
  L.push(
    actualRead === 0
      ? `  CACHE: 0 read tokens across every call — the ~542-token system prompt is below ${providerName}'s`
      : `  CACHE: ${actualRead} read tokens — the prompt IS caching; budget.ts defaults need updating`,
  );
  if (actualRead === 0) L.push('        minimum cacheable prefix, so pricing at full input rate (as budget.ts assumes) is correct.');
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
  L.push(`WROTE → ${outDir}   (${(art.bytes / 1e6).toFixed(2)} MB)`);
  L.push(`  events.jsonl       ${art.events} events, incl. ${art.reasoned} REASONED — what it thought, verbatim`);
  L.push(`  llm.jsonl          ${art.calls} call records — response + usage in full, prompt as a hash`);
  L.push(`  system-prompt.txt  the system half, stored once instead of ${art.calls} times`);
  L.push(`  (${(art.promptBytesElided / 1e6).toFixed(2)} MB of prompt text elided — recomputable from the log, hash-verified)`);
  L.push('');
  L.push(`Read a mind:      npm run sim:reasoning -- --dir ${outDir}`);
  L.push(`Rebuild a prompt: npm run sim:prompt -- --dir ${outDir} --verify`);
  process.stdout.write(L.join('\n') + '\n');

  writeFileSync(
    join(outDir, 'config.json'),
    JSON.stringify({ seed, agents, ticks, model, budget, thinkPolicy: 'every-tick', estimateUSD: est.totalUSD, actualUSD: r.costUSD, calls: calls.length, wallMs, budgetPaused: r.budgetPaused }, null, 2) + '\n',
  );
}

void main().catch(die);
