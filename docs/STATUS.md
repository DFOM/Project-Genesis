# STATUS — Project Genesis

> **Read this first.** This file is the single source of truth for where the project is.
> Every new Claude Code session should read it before doing anything. **Update it at the end
> of every work session** — phases moved, bugs found, bugs fixed. If this file is stale, the
> next window starts confused. Keeping it current is not optional.

**Last updated:** 2026-07-16 · **Branch:** main

---

## Where we are right now

**Phase 3 built and green on mocks. No live LLM call has ever been made.** The Anthropic
adapter, the provider seam, the cost gate and the full mock test suite are in and passing.
What remains is *spending money*: the live smoke test and the paired success run are the
operator's to trigger, deliberately, after reading the preflight estimate.

**The next action is a decision, not a build:** the success-criterion matrix (6 agents ×
20 seeds × 3 replicates × 1,200 ticks, `every-tick`) is projected at **$1,920.24** ($32.00/run
× 60), and the preflight gate refuses it under any smaller cap.

> **This was reported as $1,209.60 until 2026-07-16.** The estimator assumed prompt caching that
> Opus 4.8 never performs (see the bugs table). $1,920 is the measured figure; the first
> `sim:smoke` run will confirm it against real usage. **Do the smoke test first** — it costs
> ~$1.33 and settles the cost model before the 60-run batch commits to ~$1,900.

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
  multi-seed experiments → summary.md + CSVs.
- **Baseline `phase-1-1200t`** — 20 seeds × 1,200 ticks of heuristic bots, **mean 6.30 dead,
  sd 4.94**. This is the comparand for the Phase-3 LLM arm. The 5,000-tick `phase-1` tag stays
  frozen as the historical control but is **not** the comparand (different exposure).

- **Phase 3 — One Mind (code complete, unspent).** Anthropic adapter behind a provider seam
  (`src/agents/llm/`): `propose(perception) → Action[]`, the same `Mind` the bot implements.
  Structured outputs constrain the action shape; malformed output becomes the `INVALID`
  anti-verb, which the referee rejects → memory → the next prompt. Reasoning is a **`REASONED`
  event in the engine log**, emitted immediately before the action it produced; the heavy
  record (prompt/usage/cost) lives in a store sidecar joined by `callRef`. Keys via
  `KeyProvider` (env / Electron safeStorage) — never in config, log, or DB. Cost: a **preflight
  gate** that refuses to start an over-cap run, plus a mid-run cap that pauses. `MockProvider`
  makes the entire pipeline testable for $0. *(29 new tests, all green.)*

### 🔨 In progress

- *(nothing actively being coded — Phase 3 awaits a spend decision, see above)*

### ⏭️ Next

- **Phase 3 verification — costs real money, operator-triggered.**
  1. **Live smoke (~$1.33) — do this first.**
     `export ANTHROPIC_API_KEY=…` then
     `npm run sim:smoke -- --seed 42 --agents 6 --ticks 50 --budget 3`
     Confirms real responses parse, the gate blocks, the cap pauses, and — the point —
     prints **preflight vs ACTUAL per token class**, settling the cost model by evidence
     before the batch. Persists `events.jsonl` + `llm.jsonl`.
     Then read a mind: `npm run sim:reasoning -- --dir research/smoke-…`
  2. **Success run (~$1,920):** `npm run research -- --seeds 1-20 --ticks 1200 --replicates 3
     --agents 6 --provider anthropic --budget 2000 --label first-minds`, then
     `--compare research/phase-1-1200t-… research/first-minds-…`.
     **Success = mortality beats `phase-1-1200t` by more than the seed-to-seed sd (4.94).**
     If it doesn't, the perception format is wrong — fix `src/agents/llm/prompt.ts`, not later
     phases (DESIGN §9).
     ⚠ **Decide the persistence question first** (see Open/watching): as written, this run keeps
     mortality counts and discards all 432,000 reasoning traces.

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
- **Agents could have read the map's layout.** `src/agents/llm/prompt.ts` first imported
  `engine/config` for the numeric scale — but config also holds `GRAIN_MIN_X` /
  `ORE_BAND_MAX_Y`, i.e. *where the food is*. A model could have known grain is east without
  ever exploring, silently gutting the experiment. Caught by the `agents-see-only-the-contract`
  boundary rule. Fixed by `SCALE` in `engine/contract.ts` — a curated, leak-free subset (maxima,
  gains, costs, capacity; **no** map layout). *(found + fixed Phase 3)*
- **The runner would have run the success matrix at 30 agents, not 6.** LLM runs inherited the
  bot baseline's `AGENT_COUNT`, making the preflight estimate $6,048 instead of $1,210 — a 5×
  cost error *and* the wrong experiment (DESIGN §9 specifies 6). Fixed by `--agents`. Caught by
  reading the preflight output rather than trusting it. *(found + fixed Phase 3)*
- **Per-tick rates were divided by requested ticks, not completed ticks.** A budget-paused run
  that stopped at 300 of 1,200 would have reported its consumption as a quarter of the truth.
  Fixed in `diagnostics.ts`. *(found + fixed Phase 3)*

- **The cost model silently assumed prompt caching that never happens.** `budget.ts` priced 600
  tokens/call at the $0.50/M cache-read rate, and `anthropic.ts` called `cache_control` "the
  single biggest cost lever". Both false: **Opus 4.8's minimum cacheable prefix is 4,096 tokens**
  and our system prompt is **542**, so the API silently declines to cache (no error, just
  `cache_creation_input_tokens: 0`) and every call pays full $5/M input for all 542 tokens. This
  under-priced the project by **59%** — the success matrix is **$1,920**, not the $1,209 first
  reported. Caching cannot be "fixed": reaching 4,096 tokens would mean ~3,500 tokens of filler
  read on every call, and the system prompt IS the treatment. Found by measuring the real prompt
  while preparing the smoke test, before any money was spent. *(found + fixed Phase 3)*
- **The research runner threw away every reasoning trace.** `runLlm` defaults to an in-memory
  store and `runLlmBatch` passed none, so the event log and the `llm_calls` sidecar were dropped
  when each run ended — `runs.csv` kept only aggregates. On the real matrix that would have
  discarded 432,000 REASONED traces, i.e. the actual data, while nominally satisfying invariant
  #7. `npm run sim:smoke` persists `events.jsonl` + `llm.jsonl`; **the research runner still does
  not** — see Open. *(found Phase 3)*

### Open / watching
- **The prompt is unproven against a real model.** Every Phase-3 test uses `MockProvider`, which
  proves the *plumbing* (adjacency, the closed loop, determinism, the meter) and proves nothing
  about whether an actual model can survive on this perception format. That is exactly what the
  live smoke test and success run are for — and if minds don't beat bots, DESIGN §9 says the
  fault is presumed to be `prompt.ts`.
- **Token estimates are MEASURED but not yet confirmed against a real call.** The preflight now
  uses the actual rendered prompt (system 542 tok; perception mean 147 / p95 212; out ~40),
  priced with NO cache reads. `npm run sim:smoke` prints preflight-vs-actual per token class and
  will settle it. The mid-run cap is the backstop if the measurement is still off.
- **`npm run research --provider anthropic` still discards event logs and LLM records.** Only
  `sim:smoke` persists them. Before spending $1,920 on the success matrix, decide: persist all 60
  runs (~1.2 GB, since each record carries its full prompt), persist REASONED only, or persist a
  sampled subset. Spending that much and keeping only mortality counts would be the expensive
  mistake of this phase.

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
- **The experiment is over by ~tick 1,000; 5,000-tick runs are 4,000 ticks of equilibrium.**
  Confirmed empirically, not assumed: `phase-1-1200t` (20 seeds × 1,200 ticks) yields
  **mean 6.30 dead, sd 4.94** — indistinguishable from the 5,000-tick baseline's mean 6.3 /
  sd 4.9. Nothing dies between tick 1,200 and 5,000. This is why the LLM arm runs 1,200 ticks:
  identical science for ~¼ the spend ($1,210 vs $5,040).
- **Never compare an arm against a differently-sized arm.** Different exposure ⇒ different
  mortality, so the delta would measure run length rather than the treatment. `--compare` now
  **refuses** when the two dirs' `ticks` differ, and refuses a pre-Phase-3 `runs.csv` that has
  no `ticks` column at all (which is what the frozen 5,000-tick `phase-1` tag is).
- **A gated LLM run is part-bot and cannot be compared to bots.** Urgency-gating's reflex
  fallback authors some of the actions, so a gated run vs the bot baseline compares bots to a
  blend containing bots. `modelActionFraction` is recorded on every run; only 1.0
  (`--think every-tick`, the default) is eligible for the paired claim.

---

## Conventions

- Working dir has a space: always `cd "/Users/dfom/Desktop/Projects/AI Town/genesis"`.
- Run Claude Code from inside `genesis/` so `CLAUDE.md` auto-loads.
- Every phase: plan mode → approve → build → verify → commit.
- Gates that must stay green: `typecheck`, `lint`, `lint:boundaries`, `test`,
  `test:determinism`, `test:balance`, `test:scarcity`.
- **`--ticks` is required** on `npm run research`. Run length is an independent variable; it is
  never defaulted, and it is stamped into `config.json` + a `runs.csv` column.
- **No live LLM call without a deliberate decision.** `--provider mock` runs the entire pipeline
  for $0; the preflight gate refuses an over-cap run before spending, and only `--confirm-cost`
  overrides it. Tests never call the network.
- **Update this file at the end of every session.**
