# STATUS — Project Genesis

> **Read this first.** This file is the single source of truth for where the project is.
> Every new Claude Code session should read it before doing anything. **Update it at the end
> of every work session** — phases moved, bugs found, bugs fixed. If this file is stale, the
> next window starts confused. Keeping it current is not optional.

**Last updated:** 2026-07-14 · **HEAD:** da5943e · **Branch:** main

---

## Where we are right now

**Phase 2 complete. Phase 3 not started.** Agents are still heuristic bots (no LLM code
exists anywhere in `src/`). The next build is the first LLM adapter.

---

## Phases

### ✅ Done

- **Phase 0 — Skeleton.** Electron + React + TS + SQLite shell, tick loop, Play/Pause/Step/
  Speed/Reset/Fork. Window opens and ticks. *(tag: `phase-1`)*
- **Phase 1 — Engine.** Deterministic, event-sourced simulation. 32×32 world, uneven +
  clustered resources (grain east, water south, ore north & useless), scarcity that produces
  competition-driven death. Verbs: MOVE, GATHER, EAT, DRINK, DROP, REST. Referee validates;
  rejections are events. Seeded RNG threaded through state. Byte-identical replay.
  **Baseline: seed 42 → 11 dead of 30; deaths are competition-caused, not search-failure.**
  *(tag: `phase-1` — this is the frozen control group)*
- **Phase 2 — Perception & Memory.** `Perception` struct frozen and proven leak-free
  (differential non-dependence + positive control). Memory is **social** (witnessed acts of
  others), salience-weighted with logarithmic decay, and **semantically coalescing**
  (place-bound lessons + living reputations). Research runner (`npm run research`) batches
  multi-seed experiments → summary.md + CSVs (with empty model/provider cols for Phase 4).

### 🔨 In progress

- *(nothing actively being coded — between phases)*

### ⏭️ Next

- **Phase 3 — One Mind.** Anthropic adapter. Agent receives `Perception`, LLM proposes JSON
  actions, referee validates them exactly as it does bot actions. Provider-adapter interface
  (so Phase 4 can add more providers without touching the engine). Every LLM call recorded in
  the event log (prompt/response/model/tokens/cost) so replay stays exact. Keys in OS
  keychain. Cost control (urgency-gated thinking + hard budget cap). **Success = 6 LLM agents
  beat the `phase-1` bot baseline by more than the seed-to-seed stddev, tested paired on the
  same 20 seeds.**

### 🔮 Later (from DESIGN §9)

- Phase 4 — Many minds (multi-provider, keychain, roster, cost meter, mid-run spawn)
- Phase 5 — Society (SPEAK, TRANSFER, GIVE, relationships, reputation)
- Phase 6 — Concept engine (detectors, Codex, TEACH/spread) ← *the product*
- Phase 7 — Institutions (CLAIM, PROMISE/AGREE, groups, territory, borders)
- Phase 8 — Conflict & aid (SEIZE, STRIKE, disasters — aid vs. exploit)
- Phase 9 — Chronicle & science (era summaries, replay viewer, CSV export)
- Phase 10 — Ship (.dmg/.exe, onboarding)

---

## Commitments made to the reviewer (see `docs/REVIEW-RESPONSE.md`)

Not yet built — scheduled around Phase 3:

- [ ] `test:positive-sum` — prove specialise-and-exchange beats autarky
- [ ] `research --sweep abundance` — scarcity as an independent variable (do BEFORE spending tokens)
- [ ] CURRENCY detector (C1–C5) + permutation null + barter control
- [ ] PROPERTY detector via difference-in-differences
- [ ] Six-dimensional well-being as a *dependent variable* (measured, never optimised)
- [ ] Paired-seed comparison in `research --compare`

---

## Bugs & fixes

### Fixed
- **Meat-grinder mortality (73%).** World killed 22/30. Cause: search-failure (agents never
  found resources), not competition. Fixed by run-and-tumble navigation + 32×32 world +
  clustered resources. Now ~11/30, competition-caused. *(fixed Phase 1 retune)*
- **Post-scarcity paradise (3,566:1 supply:demand).** Over-corrected the above; nothing was
  ever contested. Fixed by cutting node regen/stock/count. *(fixed Phase 1 retune)*
- **Memory stutter.** 19 identical rejection entries evicted meaningful memories. Fixed by
  syntactic run-length coalescing. *(fixed Phase 2)*
- **Mass-grave register.** Survivor buffers froze full of ancient witnessed-deaths. Fixed by
  semantic coalescing (same kind + same tile → one place-bound entry). *(fixed Phase 2)*
- **Rejection spam.** ~147 own gather-rejections filled slots. Fixed by tagging rejections
  with tile + semantic coalescing → "failed to GATHER at (X,Y) ×N" place-lessons. *(fixed Phase 2)*

### Open / watching
- *(none currently)*

---

## Known sharp edges (not bugs — things to remember)

- **better-sqlite3 needs two ABI builds** — Node ABI for tests, Electron ABI for the app.
  Rebuilding one can break the other. Tests use an in-memory store, so the test path never
  needs the native build.
- **Determinism dies when the LLM enters (Phase 3).** Same seed no longer reproduces a run.
  Replay stays exact (LLM responses are logged). Runs need `--replicates N` for stochasticity;
  every LLM number is `mean ± sd` over seeds × replicates.
- **Mortality stddev is 4.9 on mean 6.3** (CV ~78%). Seed-to-seed noise is large. **Phase 3
  must compare PAIRED on the same seeds**, or the signal drowns in world-luck.

---

## Conventions

- Working dir has a space: always `cd "/Users/dfom/Desktop/Projects/AI Town/genesis"`.
- Run Claude Code from inside `genesis/` so `CLAUDE.md` auto-loads.
- Every phase: plan mode → approve → build → verify → commit.
- Gates that must stay green: `typecheck`, `lint`, `lint:boundaries`, `test`,
  `test:determinism`, `test:balance`, `test:scarcity`.
- **Update this file at the end of every session.**
