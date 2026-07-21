// The Anthropic adapter — Phase 3's one and only real provider.
//
// Everything provider-specific in GENESIS is in this file. It knows about the Anthropic SDK; it
// knows nothing about Perception, Action, the referee, or the world. Adding OpenAI in Phase 4
// means writing a sibling of this file, not editing anything else.
import Anthropic from '@anthropic-ai/sdk';
import type { KeyProvider } from './keychain.js';
import type { LlmProvider, LlmRequest, LlmResponse, StopReason } from './provider.js';

export const DEFAULT_MODEL = 'claude-opus-4-8';

export interface AnthropicOptions {
  model?: string;
  keys: KeyProvider;
  maxRetries?: number;
}

function mapStopReason(r: string | null): StopReason {
  switch (r) {
    case 'end_turn':
      return 'end_turn';
    case 'max_tokens':
      return 'max_tokens';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}

// The exact params sent to Anthropic — extracted as a PURE function so a test can prove what
// crosses the wire without a live call. NOTE: there is deliberately NO `output_config` /
// structured-output schema. The Action union is a `oneOf`, which Anthropic rejects; and dropping
// it keeps this seam text-in/text-out (see provider.ts ACTION_SCHEMA). The prompt specifies the
// shape and parse.ts + INVALID enforce it. If you re-add a schema here, test/llm.test.ts fails.
export function anthropicRequestParams(req: LlmRequest, model: string): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: req.maxTokens,
    // The system prompt is identical on every call of a run, so it is marked cacheable — but this
    // currently does NOTHING: Opus 4.8's minimum cacheable prefix is 4,096 tokens and our system
    // prompt is ~542, so the API silently declines to cache it (cache_creation_input_tokens: 0,
    // full input price every call). The marker is free and becomes live if the prompt grows past
    // 4,096 tokens; budget.ts must NOT price this loop as if reads were happening.
    system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: req.user }],
    // `thinking` is omitted: on Opus 4.8 that means no extended thinking — the cheapest per-tick
    // posture. The model still reasons inside its response, which is what REASONED records.
  };
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private readonly client: Anthropic;

  constructor(opts: AnthropicOptions) {
    this.model = opts.model ?? DEFAULT_MODEL;
    // The key crosses exactly one boundary: here. It is not stored on `this`, not logged, not
    // recorded. (Invariant #6.)
    this.client = new Anthropic({ apiKey: opts.keys.get(), maxRetries: opts.maxRetries ?? 2 });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const msg = await this.client.messages.create(anthropicRequestParams(req, this.model));

    const text = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');

    return {
      text,
      model: msg.model,
      stopReason: mapStopReason(msg.stop_reason),
      usage: {
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
        cacheReadTokens: msg.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: msg.usage.cache_creation_input_tokens ?? 0,
      },
    };
  }
}
