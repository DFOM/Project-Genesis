# GENESIS

A local desktop civilization sandbox where multi-provider AI agents may or may not invent society.

## The one rule

> **The engine owns reality. The agents only own opinions.**

Agents never mutate the world directly. They *propose* actions; a deterministic
referee validates them against world state and either applies them or rejects
them with a reason. Nothing is true until the engine records it.

## Where things live

- **Full design & build plan:** [docs/DESIGN.md](docs/DESIGN.md) — read this first. It is the source of truth for architecture, world substrate, action primitives, the Concept Engine, cost control, UI, and the phased build plan.

## Status

Project is at **setup**. No code has been written yet.

Next up per the build plan is **Phase 0 (Skeleton)** then **Phase 1 (Engine, heuristic bots, zero LLM)**. Do not advance a phase until its "done test" in DESIGN.md §9 passes.

## Ground rules for building

- Engine is a pure function `step(state, actions[]) → {state, events[]}`. Seeded RNG. No side effects.
- Event-sourced: append-only store; full state derivable by replaying from tick 0. Replay must be deterministic byte-for-byte.
- Keep the action verb list small and physical (DESIGN.md §4). Institutions are emergent patterns the engine *detects*, never new verbs.
- API keys live in the OS keychain — never in SQLite, the event log, or a committed config file.
