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

export function buildRunsCsv(reports: DiagnosticReport[]): string {
  const header = ['seed', ...METRIC_KEYS].join(',');
  const rows = reports.map((r) => {
    const m = reportToMetrics(r);
    return [r.seed, ...METRIC_KEYS.map((k) => m[k])].map(csvCell).join(',');
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

export function buildCompareMd(labelA: string, csvA: string, labelB: string, csvB: string): string {
  const a = parseRunsCsv(csvA);
  const b = parseRunsCsv(csvB);
  const L: string[] = [];
  L.push(`# Compare: ${labelA} vs ${labelB}`);
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
