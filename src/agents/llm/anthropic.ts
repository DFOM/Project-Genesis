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
    const msg = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens,
      // The system prompt is identical on every call of a run (persona + verbs + numeric scale),
      // so we mark it cacheable: after the first call it is a cache READ, ~10× cheaper. This is
      // the single biggest cost lever in the loop, which is why prompt.ts is split the way it is.
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.user }],
      // Structured outputs: CONSTRAIN the model to a valid action shape rather than asking it
      // nicely. Makes malformed output the exception instead of routine. It is not a substitute
      // for the INVALID anti-verb — a refusal or a truncation still lands here as junk.
      //
      // NOTE: thinking is deliberately omitted. On Opus 4.8 an absent `thinking` field means the
      // model runs without extended thinking — the cheapest per-tick posture. The model still
      // reasons inside its response, which is what REASONED records.
      output_config: { format: { type: 'json_schema', schema: req.schema as { [k: string]: unknown } } },
    });

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
