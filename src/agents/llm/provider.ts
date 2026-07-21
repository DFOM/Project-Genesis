// THE PROVIDER SEAM — the only provider-specific boundary in the system.
//
// Phase 3 ships exactly one implementation (anthropic.ts) plus a free test double (mock.ts).
// Phase 4 adds OpenAI/Google/xAI/DeepSeek/Ollama as SIBLINGS of this file and touches nothing
// else: not the engine, not the referee, not the store, not the prompt. If adding a provider
// ever requires editing something outside this directory, this seam is in the wrong place.
//
// Note what is NOT here: no Perception, no Action, no world concepts. A provider's whole job is
// "text in, text out, tell me what it cost." Turning a Perception into text (prompt.ts) and text
// back into a Proposal (parse.ts) is provider-independent, so it lives outside this seam and is
// written exactly once.
import type { ItemType } from '../../engine/contract.js';

// Token usage for ONE call, normalized across providers. Cache fields are separated because
// they are priced differently (a cache read is ~10× cheaper than a fresh input token) — folding
// them into `inputTokens` would silently inflate every cost estimate.
export interface Usage {
  inputTokens: number; // fresh (uncached) input
  outputTokens: number;
  cacheReadTokens: number; // served from the prompt cache
  cacheWriteTokens: number; // written to the prompt cache
}

// Why the model stopped. `refusal` and `max_tokens` are the two that produce unparseable output
// through no fault of the schema — they are the reason the INVALID anti-verb exists.
export type StopReason = 'end_turn' | 'max_tokens' | 'refusal' | 'other';

export interface LlmRequest {
  system: string; // stable across ticks → cached
  user: string; // this tick's perception
  maxTokens: number;
  // NB: no `schema` field. The seam is text-in/text-out — see ACTION_SCHEMA below for why we do
  // NOT send a response schema to any provider.
}

export interface LlmResponse {
  text: string;
  usage: Usage;
  model: string;
  stopReason: StopReason;
}

export interface LlmProvider {
  readonly name: string; // 'anthropic' | 'mock' | … — recorded, never shown to an agent
  readonly model: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

// ── The Action JSON Schema — a REFERENCE spec, never sent to a provider ──────────
// This is the canonical machine-readable shape of the Action union, kept in lockstep with
// engine/contract.ts (test/llm.test.ts asserts it). It is NOT sent to any provider as a
// structured-output constraint. Two reasons:
//
//   1. It is a `oneOf` (a discriminated union), and Anthropic's structured-output feature rejects
//      `oneOf` outright ("Schema type 'oneOf' is not supported"). Every provider's structured-
//      output dialect differs (OpenAI strict mode, Google, Ollama…); depending on one here would
//      bake a per-provider divergence into a seam whose whole job is to hide provider differences.
//   2. Even a oneOf-free flat rewrite couldn't enforce the union's real constraints (MOVE needs a
//      dir, EAT needs an item) — parse.ts would have to validate them post-hoc anyway. Structured
//      outputs would then be pure coupling with no guarantee left to give.
//
// So the SHAPE is specified in the prompt (prompt.ts, hand-written per verb) and enforced by
// parse.ts, which routes anything malformed to the INVALID anti-verb → ACTION_REJECTED → memory.
// A model that emits junk experiences the rejection and learns — the honest agent-in-a-world loop.
//
// DELIBERATE: EAT/DRINK accept ANY item, not just the edible/drinkable one. The schema constrains
// SHAPE, never RULES. The referee's rules ("only grain is edible", "item not in inventory") must
// stay reachable — an agent has to be able to try eating ore, get rejected, and learn.
const ITEMS: ItemType[] = ['ore', 'water', 'grain'];

export const ACTION_SCHEMA: unknown = {
  type: 'object',
  properties: {
    action: {
      oneOf: [
        { type: 'object', properties: { type: { const: 'MOVE' }, dir: { enum: ['N', 'S', 'E', 'W'] } }, required: ['type', 'dir'], additionalProperties: false },
        { type: 'object', properties: { type: { const: 'GATHER' } }, required: ['type'], additionalProperties: false },
        { type: 'object', properties: { type: { const: 'EAT' }, item: { enum: ITEMS } }, required: ['type', 'item'], additionalProperties: false },
        { type: 'object', properties: { type: { const: 'DRINK' }, item: { enum: ITEMS } }, required: ['type', 'item'], additionalProperties: false },
        { type: 'object', properties: { type: { const: 'DROP' }, item: { enum: ITEMS }, qty: { type: 'integer', minimum: 1 } }, required: ['type', 'item', 'qty'], additionalProperties: false },
        { type: 'object', properties: { type: { const: 'REST' } }, required: ['type'], additionalProperties: false },
      ],
    },
  },
  required: ['action'],
  additionalProperties: false,
};
