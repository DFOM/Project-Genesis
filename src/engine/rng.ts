// Seeded, pure, integer PRNG (mulberry32). The state is a single uint32 that is threaded
// through World.rng and carried in every TICK_COMPLETED event, so replay restores it
// exactly. NO Math.random, NO Date — enforced by lint. Math.imul is deterministic 32-bit
// integer multiply and is fine.

export type RngState = number; // a uint32 accumulator

export function seedRng(seed: number): RngState {
  // Fold the seed into a well-mixed uint32 starting state.
  return (seed ^ 0x9e3779b9) >>> 0;
}

// Advance the state and return the next uint32 draw alongside the new state (pure).
export function nextRng(state: RngState): { state: RngState; value: number } {
  let a = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = (t ^ (t >>> 14)) >>> 0; // uint32 in [0, 2^32)
  return { state: a >>> 0, value };
}

// Uniform integer in [0, n). n must be a positive integer.
export function randInt(state: RngState, n: number): { state: RngState; value: number } {
  const r = nextRng(state);
  return { state: r.state, value: r.value % n };
}

// Fisher–Yates shuffle producing a NEW array; threads and returns the advanced rng state.
// Deterministic given the input state — this is how the referee orders contested actions.
export function shuffle<T>(state: RngState, items: readonly T[]): { state: RngState; items: T[] } {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    const r = randInt(s, i + 1);
    s = r.state;
    const j = r.value;
    const tmp = out[i]!;
    out[i] = out[j]!;
    out[j] = tmp;
  }
  return { state: s, items: out };
}
