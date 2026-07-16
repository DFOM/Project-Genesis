// Turns per-seed DiagnosticReports into the machine-readable artifacts (runs.csv, agents.csv,
// events jsonl) and the human summary.md. The CSVs are the point — they are what gets charted
// six months from now; the markdown is a convenience on top. Schema includes model/provider
// columns (empty under heuristic bots) so Phase-4 model attribution slots in without a rewrite.
import type { AgentRecord, DiagnosticReport, NotableEvent } from '../orchestrator/diagnostics.js';

// ── summary statistics ───────────────────────────────────────────────────────
export interface Stats {
  n: number;
  mean: number;
  median: number;
  min: number;
  max: number;
  stddev: number; // population stddev — the point: is a result signal or seed luck?
}

export function summarize(values: number[]): Stats {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return { n: 0, mean: NaN, median: NaN, min: NaN, max: NaN, stddev: NaN };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  const median = n % 2 ? xs[(n - 1) / 2]! : (xs[n / 2 - 1]! + xs[n / 2]!) / 2;
  const variance = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / n;
  return { n, mean, median, min: xs[0]!, max: xs[n - 1]!, stddev: Math.sqrt(variance) };
}

// ── flat metric row (one per seed) — the shared vocabulary for csv + summary + compare ──
export const METRIC_KEYS = [
  'alive',
  'dead',
  'searchDeaths',
  'competitionDeaths',
  'supplyDemandGrain',
  'supplyDemandWater',
  'nodeZeroPct',
  'nodeLowPct',
  'nodeStockMedian',
  'meanVisibleAgents',
  'contestedGatherTicks',
  'lastUnitDecisions',
  'rejNothingToGather',
  'rejTotal',
  'medianDeathTick',
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];

function med(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
}

export function reportToMetrics(r: DiagnosticReport): Record<MetricKey, number> {
  const finite = (x: number): number => (Number.isFinite(x) ? x : 0);
  const rejTotal = Object.values(r.rejections).reduce((a, b) => a + b, 0);
  return {
    alive: r.alive,
    dead: r.dead,
    searchDeaths: r.searchFailureDeaths,
    competitionDeaths: r.competitionDeaths,
    supplyDemandGrain: finite(r.grainSupplyDemandRatio),
    supplyDemandWater: finite(r.waterSupplyDemandRatio),
    nodeZeroPct: r.nodeZeroFraction * 100,
    nodeLowPct: r.nodeLowFraction * 100,
    nodeStockMedian: r.nodeStockMedian,
    meanVisibleAgents: r.meanVisibleAgents,
    contestedGatherTicks: r.contestedGatherTicks,
    lastUnitDecisions: r.lastUnitDecisions,
    rejNothingToGather: r.rejections['nothing to gather here'] ?? 0,
    rejTotal,
    medianDeathTick: r.deaths.length ? med(r.deaths.map((d) => d.tick)) : NaN,
  };
}

// ── CSV ──────────────────────────────────────────────────────────────────────
function csvCell(v: number | string | boolean | null): string {
  if (v === null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(Math.round(v * 1000) / 1000) : '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// One row per RUN. Under bots a run is a seed; under an LLM the same seed diverges every time, so
// a run is (seed, replicate) — hence the replicate column, and hence `--replicates`.
//
// `ticks` is a column because run length is an independent variable, not a detail: a 1,200-tick
// arm and a 5,000-tick arm have different exposure and therefore different mortality, and a chart
// that mixes them is measuring the axis instead of the treatment. `--compare` refuses to compare
// two dirs whose ticks differ, and this column is what a reader checks six months from now.
//
// `modelActionFraction` is provenance: 1.0 means every action was the model's. Anything less is a
// part-model/part-bot run (urgency-gating's reflex fallback) and is NOT eligible for the paired
// claim against the bot baseline.
export interface RunRecord {
  report: DiagnosticReport;
  replicate: number;
  provider: string | null;
  model: string | null;
  modelActionFraction: number | null;
  costUSD: number | null;
}

export function botRunRecord(report: DiagnosticReport): RunRecord {
  return { report, replicate: 0, provider: 'heuristic', model: 'bot-v1', modelActionFraction: 0, costUSD: 0 };
}

const RUN_META_COLS = ['seed', 'replicate', 'ticks', 'provider', 'model', 'modelActionFraction', 'costUSD'] as const;

export function buildRunsCsv(records: RunRecord[]): string {
  const header = [...RUN_META_COLS, ...METRIC_KEYS].join(',');
  const rows = records.map((rec) => {
    const m = reportToMetrics(rec.report);
    const meta = [rec.report.seed, rec.replicate, rec.report.ticks, rec.provider, rec.model, rec.modelActionFraction, rec.costUSD];
    return [...meta, ...METRIC_KEYS.map((k) => m[k])].map(csvCell).join(',');
  });
  return [header, ...rows].join('\n') + '\n';
}

const AGENT_COLS: (keyof AgentRecord)[] = [
  'seed',
  'id',
  'spawnX',
  'spawnY',
  'alive',
  'deathTick',
  'deathCause',
  'finalSatiation',
  'finalHydration',
  'finalEnergy',
  'finalHealth',
  'totalGathered',
  'totalEaten',
  'totalDrank',
  'rejections',
  'deathsWitnessed',
  'model',
  'provider',
];

export function buildAgentsCsv(reports: DiagnosticReport[]): string {
  const header = AGENT_COLS.join(',');
  const rows: string[] = [];
  for (const r of reports) for (const a of r.agents) rows.push(AGENT_COLS.map((c) => csvCell(a[c])).join(','));
  return [header, ...rows].join('\n') + '\n';
}

export function buildEventsJsonl(events: NotableEvent[]): string {
  return [...events].sort((a, b) => a.tick - b.tick).map((e) => JSON.stringify(e)).join('\n') + '\n';
}

// ── summary.md ───────────────────────────────────────────────────────────────
export interface RunMeta {
  label: string;
  seeds: number[];
  ticks: number;
  gitSha: string;
  timestamp: string;
}

function fmt(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '—';
}

export function buildSummaryMd(reports: DiagnosticReport[], meta: RunMeta): string {
  const L: string[] = [];
  L.push(`# ${meta.label}`);
  L.push('');
  L.push(`- seeds: ${meta.seeds.length} (${meta.seeds.join(', ')})`);
  L.push(`- ticks: ${meta.ticks}`);
  L.push(`- git: \`${meta.gitSha}\``);
  L.push(`- run: ${meta.timestamp}`);
  L.push('');
  L.push('## Per seed');
  L.push('');
  L.push('| seed | alive | dead | search | comp | S:D g/w | zero% | low% | contest ticks | last-unit | rej(NTG) | visible | med death |');
  L.push('|---:|---:|---:|---:|---:|:--:|---:|---:|---:|---:|---:|---:|---:|');
  for (const r of reports) {
    const m = reportToMetrics(r);
    L.push(
      `| ${r.seed} | ${m.alive} | ${m.dead} | ${m.searchDeaths} | ${m.competitionDeaths} | ${fmt(m.supplyDemandGrain)}/${fmt(m.supplyDemandWater)} | ${fmt(m.nodeZeroPct)} | ${fmt(m.nodeLowPct)} | ${m.contestedGatherTicks} | ${m.lastUnitDecisions} | ${m.rejNothingToGather} | ${fmt(m.meanVisibleAgents)} | ${fmt(m.medianDeathTick)} |`,
    );
  }
  L.push('');
  L.push('## Aggregate across seeds');
  L.push('');
  L.push('_stddev is the point: it says whether a future (e.g. Phase-3) result is signal or seed luck._');
  L.push('');
  L.push('| metric | mean | median | min | max | stddev |');
  L.push('|:--|---:|---:|---:|---:|---:|');
  const metricsBySeed = reports.map(reportToMetrics);
  for (const k of METRIC_KEYS) {
    const s = summarize(metricsBySeed.map((m) => m[k]));
    L.push(`| ${k} | ${fmt(s.mean)} | ${fmt(s.median)} | ${fmt(s.min)} | ${fmt(s.max)} | ${fmt(s.stddev)} |`);
  }
  L.push('');
  return L.join('\n');
}

// ── compare two research dirs (bots vs Claude will be one command) ────────────
function parseRunsCsv(text: string): Map<MetricKey, number[]> {
  const lines = text.trim().split('\n');
  const header = lines[0]!.split(',');
  const out = new Map<MetricKey, number[]>();
  for (const k of METRIC_KEYS) out.set(k, []);
  for (const line of lines.slice(1)) {
    const cells = line.split(',');
    for (const k of METRIC_KEYS) {
      const i = header.indexOf(k);
      const v = i >= 0 ? Number(cells[i]) : NaN;
      out.get(k)!.push(v);
    }
  }
  return out;
}

// Read the `ticks` column. Every row of a run should carry the same value; a set is returned so a
// mixed dir is itself detectable.
export function ticksIn(csv: string): number[] {
  const lines = csv.trim().split('\n');
  const header = lines[0]!.split(',');
  const i = header.indexOf('ticks');
  if (i < 0) return [];
  return [...new Set(lines.slice(1).map((l) => Number(l.split(',')[i])).filter((n) => Number.isFinite(n)))];
}

export class TickMismatch extends Error {}

// THE WRONG-BASELINE GUARD. The frozen `phase-1` tag is a 5,000-tick bot baseline. The Phase-3 LLM
// arm runs 1,200 ticks (all mortality resolves by ~tick 1,000; the rest is equilibrium nobody
// should pay a model to think through). Comparing the two would be invalid — different exposure
// produces different mortality, and the delta would be measuring run length, not minds.
//
// So the mismatch is made IMPOSSIBLE rather than merely discouraged: compare refuses. The paired
// comparison is LLM-1200t vs phase-1-1200t, and there is no way to fat-finger it into comparing
// against the 5,000-tick tag.
export function assertSameTicks(labelA: string, csvA: string, labelB: string, csvB: string): void {
  const a = ticksIn(csvA);
  const b = ticksIn(csvB);
  if (a.length === 0 || b.length === 0) {
    throw new TickMismatch(`cannot verify run length: a runs.csv has no 'ticks' column (pre-Phase-3 output?). Regenerate both arms with the current runner before comparing.`);
  }
  if (a.length > 1 || b.length > 1) throw new TickMismatch(`a run dir mixes run lengths — ${labelA}: [${a.join(', ')}], ${labelB}: [${b.join(', ')}]`);
  if (a[0] !== b[0]) {
    throw new TickMismatch(
      `REFUSED: '${labelA}' ran ${a[0]} ticks and '${labelB}' ran ${b[0]}.\n` +
        `Different exposure ⇒ different mortality, so this comparison would measure run length, not the treatment.\n` +
        `Re-run the shorter arm's baseline at a matching length (e.g. npm run research -- --seeds 1-20 --ticks ${b[0]} --label phase-1-${b[0]}t).`,
    );
  }
}

export function buildCompareMd(labelA: string, csvA: string, labelB: string, csvB: string): string {
  assertSameTicks(labelA, csvA, labelB, csvB);
  const a = parseRunsCsv(csvA);
  const b = parseRunsCsv(csvB);
  const L: string[] = [];
  L.push(`# Compare: ${labelA} vs ${labelB}`);
  L.push(`_both arms: ${ticksIn(csvA)[0]} ticks_`);
  L.push('');
  L.push(`| metric | ${labelA} (mean ± sd) | ${labelB} (mean ± sd) | Δ mean |`);
  L.push('|:--|---:|---:|---:|');
  for (const k of METRIC_KEYS) {
    const sa = summarize(a.get(k) ?? []);
    const sb = summarize(b.get(k) ?? []);
    const delta = sb.mean - sa.mean;
    L.push(`| ${k} | ${fmt(sa.mean)} ± ${fmt(sa.stddev)} | ${fmt(sb.mean)} ± ${fmt(sb.stddev)} | ${delta >= 0 ? '+' : ''}${fmt(delta)} |`);
  }
  L.push('');
  return L.join('\n');
}
