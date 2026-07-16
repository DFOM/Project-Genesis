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
  // The JSON Schema the response must conform to (the Action union). Providers that support
  // structured outputs enforce it; those that don't ignore it and rely on parse.ts + INVALID.
  schema: unknown;
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

// ── The Action JSON Schema ───────────────────────────────────────────────────
// Handed to the provider as `output_config.format` so the model is CONSTRAINED to emit a valid
// action shape rather than asked nicely to. This is the difference between malformed output
// being routine and being an edge case. parse.ts + the INVALID anti-verb remain the safety net
// (a refusal or a max_tokens truncation still yields unparseable text).
//
// It must stay in lockstep with the `Action` union in engine/contract.ts. `actionSchemaMatches`
// in the test suite is what enforces that; if you add a verb, both change together.
//
// DELIBERATE: EAT/DRINK accept ANY item, not just the edible/drinkable one. The schema constrains
// SHAPE, never RULES. The referee's rules ("only grain is edible", "item not in inventory") must
// stay reachable — an agent has to be able to try eating ore, get rejected, and learn. Encoding
// world rules in the schema would make them unbreakable, which sounds like a feature and is
// actually the experiment quietly answering its own question: we would no longer be measuring
// whether a model can learn the physics, only whether our JSON Schema can state them.
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
