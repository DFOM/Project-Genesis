// The audit record for ONE LLM call — invariant #7 ("every LLM call is recorded").
//
// This is the HEAVY half of the split. Its light half is the REASONED event in the engine log,
// which carries the model's raw response next to the action it produced. The two are joined by
// `callRef`:
//
//   engine log :  … REASONED{callRef} → GATHERED …     ← thought beside consequence, ordered
//   sidecar    :  LlmCallRecord{callRef, prompt, usage, cost, latency}
//
// The split exists because the two halves answer different questions. "Why did agent-06 accept
// the rock at tick 412?" is a narrative question and must be a READ of one ordered stream.
// "What did this run cost, and which prompt produced that?" is an accounting question, asked in
// bulk, over data far too heavy to sit in the state log.
//
// NOTE ON KEYS: `prompt` is the rendered system+user text. It never contains an API key — keys
// live in the OS keychain and reach only the SDK client (invariant #6). Nothing in this record
// is ever logged to stdout.
import type { StopReason, Usage } from './provider.js';

export interface LlmCallRecord {
  callRef: string; // pure fn of (tick, agentId, callIndex) — joins to the REASONED event
  tick: number;
  agentId: string;
  provider: string;
  model: string;
  prompt: string; // system + user, as sent
  response: string; // raw text, as received (also in REASONED — that copy is the ordered one)
  usage: Usage;
  costUSD: number;
  latencyMs: number;
  stopReason: StopReason;
  parseOk: boolean; // false ⇒ this call produced an INVALID proposal
}

// Where records go. A CALLBACK, not a store handle: `src/agents/` must not import `src/store/`
// (dependency-cruiser enforces it), and the LLM runtime has no business knowing whether records
// land in SQLite, an array, or nowhere. The orchestrator supplies the sink.
export type RecordSink = (r: LlmCallRecord) => void;

// The deterministic call reference. MUST NOT use a uuid or a clock: two runs of a deterministic
// mock provider have to produce byte-identical event logs, and `callRef` rides in the log.
export function makeCallRef(tick: number, agentId: string, callIndex: number): string {
  return `${tick}:${agentId}:${callIndex}`;
}
