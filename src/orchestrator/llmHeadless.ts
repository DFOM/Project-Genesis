// The LLM run path. The orchestrator is the only layer that may import BOTH the agent runtime
// and the store, so this is where the two sinks are wired:
//
//   reasoning → rides with the proposal → referee → REASONED event → the event log
//   record    → RecordSink              → store.appendLlmCall → the sidecar
//   joined by → callRef
//
// It delegates the loop to `diagnose` so the LLM arm and the bot arm are measured by the SAME
// instrument. Two metrics paths would drift, and "minds beat bots" would become a comparison
// between two rulers instead of two populations.
//
// Not pure, and doesn't need to be: it reads a clock for latency. Determinism lives below it —
// it only decides WHICH minds think; the seeded rng and every rule stay in the referee.
import { CostMeter, llmMind, selectThinkers, type LlmProvider, type RetryPolicy, type Sleep, type ThinkPolicy } from '../agents/llm/index.js';
import { InMemoryEventStore, type EventStore } from '../store/index.js';
import { diagnose, type DiagnosticReport } from './diagnostics.js';
import { RunWriter, type RunArtifacts } from './persist.js';

export interface LlmRunSpec {
  seed: number;
  ticks: number; // REQUIRED, never defaulted — run length is an independent variable
  provider: LlmProvider;
  agentCount?: number;
  budgetCapUSD: number;
  thinkPolicy: ThinkPolicy;
  topK?: number; // only used when thinkPolicy is 'urgency-gated'
  persona?: 'none' | 'minimal';
  store?: EventStore;
  runId?: string;
  // When set, the run persists INCREMENTALLY into this directory (events.jsonl + llm.jsonl +
  // system-prompt.txt), appending as each tick/call completes. An early stop — budget, error,
  // Ctrl-C — still leaves a complete, readable log up to the last finished tick.
  outDir?: string;
  retry?: RetryPolicy; // transport retry; injectable so tests run instantly
  sleep?: Sleep;
}

export interface LlmRunResult {
  report: DiagnosticReport; // the same shape the bot arm produces — this is what --compare reads
  runId: string;
  provider: string;
  model: string;
  costUSD: number;
  llmCalls: number;
  artifacts?: RunArtifacts; // present when outDir was set — what landed on disk
  // PROVENANCE. The fraction of actions authored by the model rather than the reflex fallback.
  // 1.0 ⇒ every action was the model's, and the run is eligible for the paired comparison against
  // the bot baseline. Below 1.0 ⇒ the run is part-model/part-bot, and comparing it against "bots"
  // would be comparing bots against a blend containing bots (see urgency.ts). Recorded on every
  // run so no number is ever ambiguous about who authored it.
  modelActionFraction: number;
  modelActions: number;
  reflexActions: number;
  budgetPaused: boolean;
}

export async function runLlm(spec: LlmRunSpec): Promise<LlmRunResult> {
  const store = spec.store ?? new InMemoryEventStore();
  const runId = spec.runId ?? `llm-${spec.provider.name}-${spec.seed}`;
  const meter = new CostMeter(spec.budgetCapUSD);
  const tally = { model: 0, reflex: 0 };

  // Incremental persistence, if requested. The writer is fed from two places, both of which fire
  // as work completes rather than at the end: `onEvents` (per tick) and the sink (per call).
  const writer = spec.outDir !== undefined ? new RunWriter(spec.outDir) : undefined;

  // Recomputed every tick from every living agent's perception; under 'every-tick' it is everyone.
  let thinkers = new Set<string>();

  const report = await diagnose(spec.seed, spec.ticks, {
    agentCount: spec.agentCount,
    store,
    runId,
    mindFor: (agentId) =>
      llmMind(agentId, {
        provider: spec.provider,
        meter,
        sink: (r) => {
          store.appendLlmCall(runId, { callRef: r.callRef, tick: r.tick, agentId: r.agentId, payload: JSON.stringify(r) });
          writer?.appendCall(r); // durable the instant the call returns
        },
        persona: spec.persona ?? 'none',
        shouldThink: (p) => thinkers.has(p.self.id),
        tally,
        retry: spec.retry,
        sleep: spec.sleep,
      }),
    beforeTick: (perceptions) => {
      thinkers = selectThinkers(perceptions, spec.thinkPolicy, spec.topK ?? perceptions.length);
    },
    onEvents: (events) => writer?.appendEvents(events), // durable per tick
    // Second line of defense; the preflight gate is the first.
    shouldStop: () => meter.exceeded(),
  });

  const acted = tally.model + tally.reflex;
  return {
    report,
    runId,
    provider: spec.provider.name,
    model: spec.provider.model,
    costUSD: meter.totalUSD,
    llmCalls: meter.callCount,
    artifacts: writer?.summary(),
    modelActionFraction: acted > 0 ? tally.model / acted : 0,
    modelActions: tally.model,
    reflexActions: tally.reflex,
    budgetPaused: meter.exceeded(),
  };
}
