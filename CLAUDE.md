# GENESIS

A local desktop app (Electron) running a deterministic civilization simulation
where AI agents from multiple providers may or may not invent society.

Full spec: `docs/DESIGN.md` — **read it before any architectural work.**

## The one rule

**The engine owns reality. Agents only own opinions.**

Agents never mutate world state. They *propose* actions. A deterministic referee
validates each proposal against state and either applies it or rejects it with a
reason. Nothing is true because an agent said it.

## Invariants — never violate these

1. **The engine is pure.** `step(state, actions[]) → { state, events[] }`. No I/O,
   no randomness outside the seeded RNG, no LLM calls, no clock reads.
2. **Event-sourced.** The event log is the source of truth. Full state must be
   derivable by replaying from tick 0. Never mutate history.
3. **Determinism is a test, not a hope.** Same seed + same event log ⇒ identical
   final state. There is a test for this. It must pass before every merge.
4. **Perception is bounded.** An agent sees only its tile radius, its own
   inventory, and its own memory. Never the global state, never another agent's
   inventory, never the event log. No exceptions "just for debugging."
5. **Institutions are detected, never granted.** Currency, property, borders, and
   nations are patterns the concept engine finds in the event stream. Do not add
   a `money` field, a `nation` type, or a `war` flag to the engine.
6. **API keys live in the OS keychain.** Never in SQLite, never in the event log,
   never in a config file, never in a log line.
7. **Every LLM call is recorded** (prompt, response, model, tokens, cost) so runs
   are auditable and replayable.

## Stack

- Electron + electron-builder (targets: `.dmg`, `.exe`)
- TypeScript, strict mode, no `any`
- React + Canvas for the renderer
- SQLite (better-sqlite3), append-only event table
- Provider adapters behind one interface: `propose(perception) → Action[]`

## Layout

```
src/engine/      pure sim — no imports from ui/ or agents/
src/referee/     action validation
src/agents/      LLM runtime + provider adapters
src/store/       SQLite event store, replay, fork
src/ui/          React renderer
docs/DESIGN.md   the spec
```

`src/engine/` must not import from `src/agents/` or `src/ui/`. Enforce with lint.

## Commands

- `npm run dev` — app in dev mode
- `npm test` — unit tests
- `npm run test:determinism` — replay 5,000 ticks, assert identical state
- `npm run sim:headless -- --seed 42 --ticks 5000` — no UI, no LLM, fast

## Working rules

- Build phase by phase (see `docs/DESIGN.md` §9). Do not skip ahead.
- **No LLM code until Phase 3.** Phases 0–2 use heuristic bots only.
- Every new verb needs: a referee rule, a rejection reason, and a test.
- Prefer a failing test that describes the bug over a fix you can't reproduce.
- If a feature doesn't make the research question clearer, don't build it.