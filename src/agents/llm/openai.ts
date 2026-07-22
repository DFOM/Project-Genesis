// The OpenAI adapter — a SIBLING of anthropic.ts, and the proof that the provider seam works.
//
// It implements the same `LlmProvider` as Anthropic and touches nothing else: not the engine, not
// the referee, not the store, not the prompt, not parse.ts. Adding it is the minimal, surgical
// slice of Phase 4 — one provider — with no roster UI and no multi-provider worlds yet.
//
// Same decision as Anthropic: NO structured outputs. Text in, text out; the prompt specifies the
// action shape and parse.ts + the INVALID anti-verb enforce it. Sending an OpenAI-strict-mode
// schema here would bake a per-provider divergence into a seam whose whole job is to hide provider
// differences (see provider.ts ACTION_SCHEMA).
import OpenAI from 'openai';
import type { KeyProvider } from './keychain.js';
import type { LlmProvider, LlmRequest, LlmResponse, StopReason } from './provider.js';

export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

export interface OpenAIOptions {
  model?: string;
  keys: KeyProvider;
}

// finish_reason → our normalized StopReason. 'length' is OpenAI's max_tokens truncation;
// 'content_filter' is its refusal. Both yield unparseable output → the INVALID anti-verb.
function mapFinishReason(r: string | null | undefined): StopReason {
  switch (r) {
    case 'stop':
      return 'end_turn';
    case 'length':
      return 'max_tokens';
    case 'content_filter':
      return 'refusal';
    default:
      return 'other';
  }
}

// The exact params sent to OpenAI — a PURE function, so a test can prove what crosses the wire
// without a live call (mirrors anthropicRequestParams). `max_completion_tokens`, not the
// deprecated `max_tokens`. System prompt as a `system` role message; no schema.
export function openaiRequestParams(req: LlmRequest, model: string): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
  return {
    model,
    max_completion_tokens: req.maxTokens,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
  };
}

export class OpenAIProvider implements LlmProvider {
  readonly name = 'openai';
  readonly model: string;
  private readonly client: OpenAI;

  constructor(opts: OpenAIOptions) {
    this.model = opts.model ?? DEFAULT_OPENAI_MODEL;
    // The key crosses exactly one boundary: here (invariant #6). maxRetries: 0 — retry is owned by
    // retry.ts so both providers share ONE policy; letting the SDK also retry would double it.
    this.client = new OpenAI({ apiKey: opts.keys.get(), maxRetries: 0 });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await this.client.chat.completions.create(openaiRequestParams(req, this.model));
    const choice = res.choices[0];
    const text = choice?.message?.content ?? '';

    // OpenAI's prompt_tokens INCLUDES cached tokens (Anthropic's input_tokens excludes them). Split
    // them so pricing.ts bills fresh input and cache reads at their different rates, matching the
    // Usage contract. Our ~689-token prompt is below OpenAI's 1,024-token auto-cache threshold, so
    // cached is 0 in practice — but read it honestly rather than assume.
    const cached = res.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const promptTokens = res.usage?.prompt_tokens ?? 0;

    return {
      text,
      model: res.model,
      stopReason: mapFinishReason(choice?.finish_reason),
      usage: {
        inputTokens: Math.max(0, promptTokens - cached),
        outputTokens: res.usage?.completion_tokens ?? 0,
        cacheReadTokens: cached,
        cacheWriteTokens: 0, // OpenAI auto-caches with no separate write charge
      },
    };
  }
}
