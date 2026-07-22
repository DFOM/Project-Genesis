// Transport-level retry with exponential backoff. Provider-agnostic: it wraps `complete()` in
// llmMind, so Anthropic and OpenAI (and every Phase-4 sibling) get identical behaviour without
// each SDK's own retry logic diverging. We disable the SDKs' built-in retries and own it here, so
// there is exactly one policy to reason about.
//
// WHAT IT DOES NOT DO: change the sim. Retries are outside the seeded engine entirely — a retry
// produces exactly ONE LlmResponse, hence one proposal, hence one REASONED event. The event log
// never sees that a call was attempted three times; it sees the one answer that came back (or, on
// exhaustion, the INVALID that llmMind synthesises). So determinism of the *world* is untouched;
// the wall-clock delay is the only observable effect, and delays never enter engine state.
//
// Retry ONLY the transient transport failures — rate limits (429), overload (529), and 5xx — plus
// raw connection drops. A 400/401/403 is a bug in the request or the key; retrying it just burns
// time and, for 401, hammers a dead key. Those propagate immediately and llmMind turns them into
// INVALID like any other failure.

export interface RetryPolicy {
  maxAttempts: number; // total tries INCLUDING the first (so 4 = 1 try + 3 retries)
  baseDelayMs: number; // first backoff; doubles each retry
  maxDelayMs: number; // ceiling on a single backoff
}

// 4 attempts over ~0.5+1+2s of backoff (+jitter) rides out the typical rate-limit blip without
// stalling a 7,200-call run for minutes if a provider is genuinely down.
export const DEFAULT_RETRY: RetryPolicy = { maxAttempts: 4, baseDelayMs: 500, maxDelayMs: 8000 };

// No retries, no waiting — for the mock path and for tests that assert the happy path fast.
export const NO_RETRY: RetryPolicy = { maxAttempts: 1, baseDelayMs: 0, maxDelayMs: 0 };

export function isRetryableStatus(status: number | undefined): boolean {
  if (status === undefined) return false;
  return status === 429 || status === 529 || (status >= 500 && status < 600);
}

// Classify by HTTP status (both SDKs put it on the error) or by a connection-error signature.
export function isRetryable(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { status?: number; code?: string; name?: string };
  if (isRetryableStatus(e.status)) return true;
  // Connection-level failures, before any HTTP status exists. Both SDKs surface these as
  // `APIConnectionError` / `APIConnectionTimeoutError`; node raises the *codes.
  if (e.name === 'APIConnectionError' || e.name === 'APIConnectionTimeoutError') return true;
  return e.code === 'ECONNRESET' || e.code === 'ETIMEDOUT' || e.code === 'ECONNREFUSED' || e.code === 'EPIPE' || e.code === 'ENOTFOUND';
}

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Full-jitter exponential backoff. Jitter uses Math.random — fine here precisely BECAUSE the delay
// never touches engine state (see the header). The seeded world does not observe it.
function backoffMs(attempt: number, policy: RetryPolicy): number {
  const capped = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(capped * (0.5 + Math.random() * 0.5));
}

// Run `fn`, retrying transient failures per `policy`. On success returns the value; on a
// non-retryable error, or after the last attempt, throws the last error (llmMind → INVALID).
// `sleep` is injectable so tests run instantly and assert attempt counts without real timers.
export async function withRetry<T>(fn: () => Promise<T>, policy: RetryPolicy = DEFAULT_RETRY, sleep: Sleep = realSleep): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= policy.maxAttempts || !isRetryable(err)) throw err;
      await sleep(backoffMs(attempt, policy));
    }
  }
}
