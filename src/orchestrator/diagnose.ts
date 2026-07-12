// npm run sim:diagnose -- --seed 42 --ticks 5000
// Headless instrumentation of why agents die. No UI, no LLM, no persistence.
import { diagnose, formatReport } from './diagnostics.js';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) {
    const v = Number(process.argv[i + 1]);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}

const seed = arg('seed', 42);
const ticks = arg('ticks', 5000);
process.stdout.write(formatReport(diagnose(seed, ticks)) + '\n');
