// The batch experiment runner — the instrument for every phase from 3 onward, since all of them
// are comparisons (bots vs Claude, Claude vs GPT).
//
//   Bots (free, parallel across seeds):
//     npm run research -- --seeds 1-20 --ticks 1200 --label phase-1-1200t
//
//   LLM (costs real money; refuses to start over budget):
//     npm run research -- --seeds 1-20 --ticks 1200 --replicates 3 --agents 6 \
//                         --provider anthropic --model claude-opus-4-8 --budget 1300 --label first-minds
//
//   The same batch for $0, to shake it out before paying for it:
//     npm run research -- --seeds 1-20 --ticks 1200 --replicates 3 --agents 6 \
//                         --provider mock --budget 1 --label dry
//
//   Compare (refuses when the two arms' run lengths differ):
//     npm run research -- --compare research/phase-1-1200t-… research/first-minds-…
//
// TWO RULES THIS FILE ENFORCES
//
// 1. `--ticks` IS REQUIRED. It used to default to 5,000. A defaulted independent variable is a
//    confound with a friendly face: you get a number, you chart it, and nothing on the chart says
//    the arms had different exposure. It is now explicit, stamped into config.json and carried as
//    a column in runs.csv.
// 2. NOTHING SPENDS BEFORE THE ESTIMATE IS ON SCREEN. The preflight gate is the first line of
//    defense; the mid-run cap is the backstop. A 60-run batch must never begin billing before its
//    projected total has been shown and accepted.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import { execSync } from 'node:child_process';
import * as engineConfig from '../engine/config.js';
import { AnthropicProvider, assertAffordable, envKeyProvider, estimateRun, formatEstimate, MockProvider, type LlmCallRecord, type LlmProvider } from '../agents/llm/index.js';
import { runLlm } from '../orchestrator/llmHeadless.js';
import { writeRunArtifacts } from '../orchestrator/persist.js';
import { InMemoryEventStore } from '../store/index.js';
import type { DiagnosticReport } from '../orchestrator/diagnostics.js';
import { botRunRecord, buildRunsCsv, buildAgentsCsv, buildEventsJsonl, buildSummaryMd, buildCompareMd, type RunMeta, type RunRecord } from './analysis.js';

function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

// "1,7,42" or "1-20" (or a mix) → sorted unique seed list.
function parseSeeds(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) {
      for (let s = Number(m[1]); s <= Number(m[2]); s++) out.add(s);
    } else if (/^\d+$/.test(part)) {
      out.add(Number(part));
    }
  }
  return [...out].sort((a, b) => a - b);
}

function gitSha(): string {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

// Run all seeds across a worker pool; resolves to seed→report. Deterministic per seed regardless
// of scheduling (diagnose is pure and independent). BOTS ONLY — LLM runs are API-bound, not
// CPU-bound, and must share one budget meter, so they do not go through this pool.
function runBotBatch(seeds: number[], ticks: number): Promise<Map<number, DiagnosticReport>> {
  return new Promise((resolve, reject) => {
    const results = new Map<number, DiagnosticReport>();
    const queue = [...seeds];
    const workerUrl = new URL('./worker.ts', import.meta.url);
    const poolSize = Math.max(1, Math.min(queue.length, cpus().length - 1));
    let active = poolSize;
    let done = 0;
    for (let i = 0; i < poolSize; i++) {
      const worker = new Worker(workerUrl, { execArgv: ['--import', 'tsx'] });
      const feed = (): void => {
        const seed = queue.shift();
        if (seed === undefined) {
          void worker.terminate();
          active--;
          if (active === 0) resolve(results);
          return;
        }
        worker.postMessage({ seed, ticks });
      };
      worker.on('message', (msg: { seed: number; report: DiagnosticReport }) => {
        results.set(msg.seed, msg.report);
        process.stderr.write(`  seed ${msg.seed} done (${++done}/${seeds.length})\n`);
        feed();
      });
      worker.on('error', reject);
      feed();
    }
  });
}

function makeProvider(providerName: string, model: string): LlmProvider {
  switch (providerName) {
    case 'anthropic':
      return new AnthropicProvider({ model, keys: envKeyProvider() });
    // A full research run against the mock: costs $0, spends no tokens, and exercises the entire
    // pipeline end to end. This is how you shake out a batch before paying for one.
    case 'mock':
      return new MockProvider(() => '{"action":{"type":"REST"}}', model);
    default:
      throw new Error(`unknown provider '${providerName}' — Phase 3 ships 'anthropic' and 'mock'. (OpenAI/Google/Ollama are Phase 4: add a sibling of src/agents/llm/anthropic.ts.)`);
  }
}

// Every LLM run persists its own event log + call records, one directory per run.
//
// This used to be the phase's most expensive latent mistake: `runLlm` defaults to an in-memory
// store and nothing here passed one, so each run's log — every REASONED trace the model produced —
// was garbage-collected the moment the run returned, and only the mortality counts in runs.csv
// survived. On the 60-run matrix that is 432,000 paid reasoning traces discarded to keep a number
// you could have got from bots. Aggregates are a summary OF the experiment; the traces ARE it.
//
// Prompts are stored as content hashes (see persist.ts) — recomputable from the log we already
// keep, and `npm run sim:prompt --verify` proves the recomputation is faithful. Responses and
// token usage are stored in full: those are the model's, not ours to regenerate.
async function runLlmBatch(
  seeds: number[],
  ticks: number,
  replicates: number,
  provider: LlmProvider,
  budget: number,
  thinkPolicy: 'every-tick' | 'urgency-gated',
  topK: number | undefined,
  agentCount: number,
  outDir: string,
): Promise<RunRecord[]> {
  const out: RunRecord[] = [];
  let done = 0;
  let bytes = 0;
  const total = seeds.length * replicates;
  for (const seed of seeds) {
    for (let rep = 0; rep < replicates; rep++) {
      const runId = `${provider.name}-${seed}-r${rep}`;
      const store = new InMemoryEventStore();
      const r = await runLlm({ seed, ticks, agentCount, provider, budgetCapUSD: budget, thinkPolicy, topK, store, runId });

      // Persist BEFORE anything else can go wrong. A crash after this point costs a summary row;
      // a crash before it costs the run's entire paid output.
      const calls = store.readLlmCalls(runId).map((row) => JSON.parse(row.payload) as LlmCallRecord);
      const art = writeRunArtifacts(join(outDir, 'runs', runId), store.read(runId), calls);
      bytes += art.bytes;

      out.push({ report: r.report, replicate: rep, provider: r.provider, model: r.model, modelActionFraction: r.modelActionFraction, costUSD: r.costUSD });
      process.stderr.write(
        `  seed ${seed} rep ${rep} done (${++done}/${total}) — $${r.costUSD.toFixed(2)} spent, ${r.llmCalls} calls, model-authored ${(r.modelActionFraction * 100).toFixed(0)}% · kept ${art.reasoned} traces (${(art.bytes / 1e6).toFixed(1)} MB)${r.budgetPaused ? ' [BUDGET PAUSED]' : ''}\n`,
      );
      if (r.budgetPaused) {
        process.stderr.write(`\nBUDGET CAP HIT ($${budget.toFixed(2)}). Stopping the batch — ${total - done} runs not started.\n`);
        process.stderr.write(`Everything already paid for is on disk in ${join(outDir, 'runs')}.\n`);
        return out;
      }
    }
  }
  process.stderr.write(`\nkept ${(bytes / 1e6).toFixed(1)} MB of event logs + call records across ${done} runs\n`);
  return out;
}

async function runExperiment(): Promise<void> {
  const seeds = parseSeeds(argVal('seeds') ?? '42');
  if (seeds.length === 0) throw new Error('no seeds — use --seeds 1,7,42 or --seeds 1-20');

  // REQUIRED. See rule 1 at the top of this file.
  const ticksArg = argVal('ticks');
  if (ticksArg === undefined) {
    throw new Error(
      '--ticks is required.\n' +
        'Run length is an independent variable, not a default: a 1,200-tick arm and a 5,000-tick arm\n' +
        'have different exposure and therefore different mortality, and nothing downstream would tell\n' +
        'you they differed. State it explicitly (Phase 3 uses --ticks 1200 for both arms).',
    );
  }
  const ticks = Number(ticksArg);
  if (!Number.isInteger(ticks) || ticks <= 0) throw new Error(`--ticks must be a positive integer, got '${ticksArg}'`);

  const label = argVal('label') ?? 'run';
  const replicates = Number(argVal('replicates') ?? '1');
  if (!Number.isInteger(replicates) || replicates < 1) throw new Error(`--replicates must be a positive integer, got '${argVal('replicates')}'`);
  const providerName = argVal('provider') ?? 'heuristic';
  const isLlm = providerName !== 'heuristic';

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join('research', `${label}-${timestamp}`);

  let records: RunRecord[];
  const start = Date.now();
  let estimateText = '';

  if (!isLlm) {
    // Bots: free, deterministic, parallel. Replicates are meaningless (same seed ⇒ same run), so
    // say so rather than silently running 3 identical worlds and calling them samples.
    if (replicates > 1) throw new Error('--replicates is meaningless for heuristic bots: the same seed reproduces the same run byte-for-byte. It exists for LLM stochasticity (EXPERIMENT-CONTROL §0).');
    process.stderr.write(`research: ${seeds.length} seeds × ${ticks} ticks (heuristic bots, free) → ${outDir}\n`);
    const resultMap = await runBotBatch(seeds, ticks);
    records = seeds.map((s) => botRunRecord(resultMap.get(s)!)); // sorted by seed → deterministic file order
  } else {
    const model = argVal('model') ?? 'claude-opus-4-8';
    const budget = Number(argVal('budget') ?? '0');
    if (!(budget > 0)) throw new Error('--budget <USD> is required for an LLM run. There is no default: an unbounded overnight batch is exactly what the cap exists to prevent.');
    const thinkPolicy = (argVal('think') ?? 'every-tick') as 'every-tick' | 'urgency-gated';
    const topKArg = argVal('topk');
    const topK = topKArg !== undefined ? Number(topKArg) : undefined;
    // Population size is an independent variable AND the dominant cost term — 30 agents is 5× the
    // bill of 6. The Phase-3 success criterion is 6 LLM agents (DESIGN §9), so it must be settable
    // rather than silently inheriting the bot baseline's 30.
    const agents = Number(argVal('agents') ?? engineConfig.AGENT_COUNT);
    if (!Number.isInteger(agents) || agents < 1) throw new Error(`--agents must be a positive integer, got '${argVal('agents')}'`);
    const thinkRate = thinkPolicy === 'every-tick' ? 1 : Math.min(1, (topK ?? agents) / agents);

    // ── THE PREFLIGHT GATE — first line of defense ──────────────────────────
    const est = estimateRun({ agents, ticks, runs: seeds.length * replicates, thinkRate, model });
    estimateText = formatEstimate(est, budget);
    process.stderr.write(`${estimateText}\n\n`);
    assertAffordable(est, budget, hasFlag('confirm-cost')); // throws BudgetRefused → nothing spent

    if (thinkPolicy !== 'every-tick') {
      process.stderr.write(
        `WARNING: --think ${thinkPolicy} means some actions come from the REFLEX fallback, not the model.\n` +
          `  This run is part-model/part-bot and is NOT eligible for the paired comparison against the\n` +
          `  bot baseline (see urgency.ts). modelActionFraction will record the true split.\n\n`,
      );
    }

    const provider = makeProvider(providerName, model);
    mkdirSync(outDir, { recursive: true }); // needed now: runs persist as they go, not at the end
    process.stderr.write(`research: ${seeds.length} seeds × ${replicates} replicates × ${ticks} ticks × ${agents} agents (${providerName}/${model}) → ${outDir}\n`);
    records = await runLlmBatch(seeds, ticks, replicates, provider, budget, thinkPolicy, topK, agents, outDir);
  }

  const ms = Date.now() - start;
  mkdirSync(join(outDir, 'events'), { recursive: true });
  const reports = records.map((r) => r.report);
  const meta: RunMeta = { label, seeds, ticks, gitSha: gitSha(), timestamp };
  writeFileSync(join(outDir, 'summary.md'), buildSummaryMd(reports, meta));
  writeFileSync(join(outDir, 'runs.csv'), buildRunsCsv(records));
  writeFileSync(join(outDir, 'agents.csv'), buildAgentsCsv(reports));
  for (const r of records) writeFileSync(join(outDir, 'events', `${r.report.seed}-r${r.replicate}.jsonl`), buildEventsJsonl(r.report.notableEvents));
  // config snapshot + git SHA: a result you can't reproduce is a rumour.
  const configSnapshot = Object.fromEntries(Object.entries(engineConfig));
  const totalCost = records.reduce((a, r) => a + (r.costUSD ?? 0), 0);
  writeFileSync(
    join(outDir, 'config.json'),
    JSON.stringify({ ...meta, ticks, replicates, provider: providerName, model: argVal('model') ?? null, thinkPolicy: argVal('think') ?? 'every-tick', durationMs: ms, totalCostUSD: totalCost, estimate: estimateText, config: configSnapshot }, null, 2) + '\n',
  );

  process.stdout.write(`\ndone in ${(ms / 1000).toFixed(1)}s → ${outDir}\n  summary.md · runs.csv · agents.csv · events/*.jsonl · config.json\n`);
  if (isLlm) {
    process.stdout.write(`  actual spend: $${totalCost.toFixed(2)}\n`);
    process.stdout.write(`  runs/<runId>/  events.jsonl (incl. every REASONED) · llm.jsonl · system-prompt.txt\n`);
    process.stdout.write(`\nRead a mind:      npm run sim:reasoning -- --dir ${join(outDir, 'runs', `${providerName}-${seeds[0]}-r0`)}\n`);
    process.stdout.write(`Rebuild a prompt: npm run sim:prompt -- --dir ${join(outDir, 'runs', `${providerName}-${seeds[0]}-r0`)} --verify\n`);
  }
}

function runCompare(dirA: string, dirB: string): void {
  const csvA = readFileSync(join(dirA, 'runs.csv'), 'utf8');
  const csvB = readFileSync(join(dirB, 'runs.csv'), 'utf8');
  process.stdout.write(buildCompareMd(basename(dirA), csvA, basename(dirB), csvB) + '\n');
}

// A refusal is a MESSAGE, not a stack trace. These guards exist to be read by a person deciding
// whether to spend money or whether a comparison is valid — a wall of internal frames buries the
// one sentence that matters.
function die(err: unknown): never {
  process.stderr.write(`\n${err instanceof Error ? err.message : String(err)}\n\n`);
  process.exit(1);
}

const compareIdx = process.argv.indexOf('--compare');
if (compareIdx >= 0) {
  const dirA = process.argv[compareIdx + 1];
  const dirB = process.argv[compareIdx + 2];
  if (!dirA || !dirB) die(new Error('--compare needs two directories'));
  try {
    runCompare(dirA, dirB);
  } catch (err) {
    die(err);
  }
} else {
  void runExperiment().catch(die);
}
