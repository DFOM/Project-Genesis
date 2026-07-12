// Headless runner: no UI, no LLM, no persistence beyond an in-memory log. Runs the pure
// engine + heuristic bots as fast as possible. Prints the alive/dead split and a hash of the
// final state so a run can be spot-checked for reproducibility from the command line.
//
//   npm run sim:headless -- --seed 42 --ticks 5000
import { createHash } from 'node:crypto';
import { runHeadless } from './harness.js';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) {
    const v = Number(process.argv[i + 1]);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}

async function main(): Promise<void> {
  const seed = arg('seed', 42);
  const ticks = arg('ticks', 5000);
  const start = Date.now();
  const r = await runHeadless(seed, ticks);
  const ms = Date.now() - start;
  const hash = createHash('sha256').update(r.finalState).digest('hex');
  process.stdout.write(
    `GENESIS headless — seed ${seed}, ${ticks} ticks in ${ms} ms\n` +
      `  agents: ${r.alive} alive / ${r.dead} dead (of ${r.alive + r.dead})\n` +
      `  events: ${r.events.length}\n` +
      `  final-state sha256: ${hash}\n`,
  );
}

void main();
