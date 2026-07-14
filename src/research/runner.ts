// npm run research -- --seeds 1,7,42,99,777 --ticks 5000 --label baseline-bots
// npm run research -- --seeds 1-20 --ticks 5000 --label phase1-baseline
// npm run research -- --compare research/dirA research/dirB
//
// A batch experiment runner: the instrument for every phase from 3 onward, since all of them
// are comparisons (bots vs Claude, Claude vs GPT). Runs are independent, deterministic, and
// parallelized across seeds (worker threads); a seed is byte-identical alone or in a batch of 20.
// It reuses the sim:diagnose metrics path so there is no second, drifting source of truth.
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { cpus } from 'node:os';
import { Worker } from 'node:worker_threads';
import { execSync } from 'node:child_process';
import * as engineConfig from '../engine/config.js';
import type { DiagnosticReport } from '../orchestrator/diagnostics.js';
import { buildRunsCsv, buildAgentsCsv, buildEventsJsonl, buildSummaryMd, buildCompareMd, type RunMeta } from './analysis.js';

function argVal(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
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
// of scheduling (diagnose is pure and independent).
function runBatch(seeds: number[], ticks: number): Promise<Map<number, DiagnosticReport>> {
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

async function runExperiment(): Promise<void> {
  const seeds = parseSeeds(argVal('seeds') ?? '42');
  const ticks = Number(argVal('ticks') ?? '5000');
  const label = argVal('label') ?? 'run';
  if (seeds.length === 0) throw new Error('no seeds — use --seeds 1,7,42 or --seeds 1-20');

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outDir = join('research', `${label}-${timestamp}`);
  mkdirSync(join(outDir, 'events'), { recursive: true });

  process.stderr.write(`research: ${seeds.length} seeds × ${ticks} ticks → ${outDir}\n`);
  const start = Date.now();
  const resultMap = await runBatch(seeds, ticks);
  const reports = seeds.map((s) => resultMap.get(s)!); // sorted by seed → deterministic file order
  const ms = Date.now() - start;

  const meta: RunMeta = { label, seeds, ticks, gitSha: gitSha(), timestamp };
  writeFileSync(join(outDir, 'summary.md'), buildSummaryMd(reports, meta));
  writeFileSync(join(outDir, 'runs.csv'), buildRunsCsv(reports));
  writeFileSync(join(outDir, 'agents.csv'), buildAgentsCsv(reports));
  for (const r of reports) writeFileSync(join(outDir, 'events', `${r.seed}.jsonl`), buildEventsJsonl(r.notableEvents));
  // config snapshot + git SHA: a result you can't reproduce is a rumour.
  const configSnapshot = Object.fromEntries(Object.entries(engineConfig));
  writeFileSync(join(outDir, 'config.json'), JSON.stringify({ ...meta, durationMs: ms, config: configSnapshot }, null, 2) + '\n');

  process.stdout.write(`\ndone in ${(ms / 1000).toFixed(1)}s → ${outDir}\n  summary.md · runs.csv · agents.csv · events/*.jsonl · config.json\n`);
}

function runCompare(dirA: string, dirB: string): void {
  const csvA = readFileSync(join(dirA, 'runs.csv'), 'utf8');
  const csvB = readFileSync(join(dirB, 'runs.csv'), 'utf8');
  process.stdout.write(buildCompareMd(basename(dirA), csvA, basename(dirB), csvB) + '\n');
}

const compareIdx = process.argv.indexOf('--compare');
if (compareIdx >= 0) {
  const dirA = process.argv[compareIdx + 1];
  const dirB = process.argv[compareIdx + 2];
  if (!dirA || !dirB) throw new Error('--compare needs two directories');
  runCompare(dirA, dirB);
} else {
  void runExperiment();
}
