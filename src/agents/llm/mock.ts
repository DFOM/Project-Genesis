// The free test engine. Every test in Phase 3 runs through this: the whole pipeline
// (render → complete → parse → validate → reject → record → remember) is exercised end to end
// for exactly $0 and zero network. DESIGN §7.6 calls this dry-run mode and says "you will use
// this constantly" — correct.
//
// It is also the ONLY way to test the LLM path deterministically. A real model is stochastic by
// definition; a mock that is a pure function of its request is not, so two runs produce
// byte-identical event logs and `test:determinism`'s guarantee extends over the LLM seam.
import type { LlmProvider, LlmRequest, LlmResponse, StopReason } from './provider.js';

// Decide what this call returns, purely from the request. Pure in ⇒ pure out ⇒ deterministic run.
// A script may also THROW — to simulate a transport failure (retry / error→INVALID paths). Attach
// a `status` to the thrown error to exercise retry classification, e.g.
//   throw Object.assign(new Error('rate limited'), { status: 429 });
export type MockScript = (req: LlmRequest, callIndex: number) => string | Partial<LlmResponse>;

// Build a status-coded error the way both SDKs surface one — for tests of retry/backoff.
export function httpError(status: number, message = `HTTP ${status}`): Error {
  return Object.assign(new Error(message), { status });
}

export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model: string;
  private readonly script: MockScript;
  private calls = 0;

  constructor(script: MockScript, model = 'mock') {
    this.script = script;
    this.model = model;
  }

  get callCount(): number {
    return this.calls;
  }

  // `async` so a script that THROWS produces a rejected promise (uniform with a real SDK), which
  // withRetry classifies and llmMind turns into an INVALID.
  async complete(req: LlmRequest): Promise<LlmResponse> {
    const out = this.script(req, this.calls++);
    const partial: Partial<LlmResponse> = typeof out === 'string' ? { text: out } : out;
    return {
      text: partial.text ?? '',
      model: partial.model ?? this.model,
      stopReason: partial.stopReason ?? ('end_turn' as StopReason),
      // Token counts are deterministic stand-ins, priced at $0 (see pricing.ts 'mock'). They are
      // real numbers rather than zeros so the recording/metering code paths are genuinely
      // exercised — a meter only ever fed zeros is a meter nobody has tested.
      usage: partial.usage ?? { inputTokens: Math.ceil(req.user.length / 4), outputTokens: 20, cacheReadTokens: Math.ceil(req.system.length / 4), cacheWriteTokens: 0 },
    };
  }
}

// The commonest script: always propose the same action.
export function always(action: string): MockScript {
  return () => action;
}
