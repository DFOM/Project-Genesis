# Project Genesis — Response to Review
### Addendum to `docs/DESIGN.md` · answers to J. Ricketts, 14 July 2026

Four substantive criticisms. Three are accepted and specified below as concrete, testable
work. One is accepted in principle but **inverted in implementation**, for reasons given in §4.

---

## 1. "Is the world even capable of cooperation?"

**Accepted, with a correction: it already is — and provably so. The affordance to *realise*
it is what's missing.**

### The gains from trade are in the physics, not in a feature

The world has two survival needs, separated geographically (grain east, water south), and
movement costs energy. Consider two agents, A near the grain and B near the water:

| Strategy | A's energy cost | B's energy cost | Total |
|---|---|---|---|
| **Autarky** — each shuttles east↔south alone | 2 long trips | 2 long trips | 4 long trips |
| **Specialise + exchange** — A gathers grain, B gathers water, meet at the seam | 1 short trip | 1 short trip | 2 short trips |

Whenever the seam is closer to each agent than the opposite resource — which is true across
most of the map — **specialisation and exchange is strictly Pareto-superior to autarky.**
This is Ricardian comparative advantage arising from the terrain, not from a cooperation
mechanic bolted on. The world is positive-sum **by construction**, not zero-sum.

**Deliverable — `npm run test:positive-sum` (a stated, machine-checked precondition):**
Compute, over the seed-42 map, the energy cost of the optimal autarkic policy versus the
optimal specialise-and-exchange policy for a matched agent pair. Assert the latter is strictly
cheaper. This turns "cooperation is possible" from an assumption into a proven property of the
world, checked on every commit. It directly answers the precondition the review asks us to
state explicitly.

### Trade already exists — and it is non-atomic, which is the interesting part

`DROP` + `GATHER` already constitutes an exchange: A drops grain, B drops water, each picks up
the other's. Nothing enforces simultaneity. **Either party can take and walk away.**

This is not a defect to be patched. It means **trade in Genesis requires trust**, and trust
requires memory of who has defected — which is exactly what the witnessed-memory system
(Phase 2: `witnessed_dropped`, `witnessed_gathered`, salience-weighted, decaying) was built to
support. An atomic `TRANSFER` verb would make betrayal *impossible*, and a world where you
cannot be cheated cannot teach us anything about whether agents choose not to cheat.

**Deliverable — trust as an experimental arm (Phase 5).** Implement both exchange modes and
compare them as an independent variable:

| Arm | Mechanism | Question |
|---|---|---|
| **Trustless** | atomic `TRANSFER` — simultaneous, enforced, defection impossible | baseline rate of exchange |
| **Trustful** | `DROP`/`GATHER` — sequential, defection trivially available | do agents exchange anyway? |

The measurement: **defection rate** (took and did not reciprocate), **exchange volume**, and
**whether defectors are subsequently avoided** (does reputation form?). Cross this with
provider, and the question becomes: *do models cooperate when they could get away with
cheating, and do they punish those who don't?* This is a stronger question than the review
asks for, and the substrate already supports it.

---

## 2. "Scarcity tuning is a potential confound"

**Fully accepted. This is the strongest criticism in the review and it is correct.**

A single tuned world (seed 42, competition-driven) cannot support a claim about emergence.
Tuned harsh, it engineers a Hobbesian trap and *guarantees* conflict; tuned soft, nothing is
scarce enough to trade over. Either way the conclusion is installed by the tuning.

**Deliverable — scarcity as an independent variable, swept:**

```
npm run research -- --sweep abundance=0.25,0.5,1.0,2.0,4.0 --seeds 1-20 --ticks 5000
```

`abundance` is a single scalar multiplier over node count, node stock, and regen rate.
`abundance=1.0` is the current tuned world. 5 levels × 20 seeds = 100 runs, fully parallel,
deterministic, ~2 minutes on the existing engine.

**Output: a phase diagram** — outcome metrics as a function of scarcity, with seed-to-seed
standard deviation as error bars.

Expected regimes, and the point of the exercise:

| Regime | Prediction | What it forecloses |
|---|---|---|
| **Famine** (0.25) | Mass death; no surplus; nothing to trade | Cooperation impossible — outcome is *engineered* |
| **Contested** (0.5–2.0) | Depletion, competition, survivable with slack | Cooperation *possible but not forced* ← **the only honest operating band** |
| **Post-scarcity** (4.0) | No depletion; no contest; agents never interact | Cooperation *pointless* — outcome is engineered the other way |

Every claim the project later makes about emergence will be reported **as a function of
abundance**, not at a single point — and the band where cooperation is neither impossible nor
unnecessary will be identified empirically rather than asserted. If institutions emerge only
at one abundance level, that is itself a finding, and a far more interesting one than a single
tuned run.

*(Note: the Phase-1 retune already caught a version of this error empirically — the world was
briefly at ~3,566:1 supply:demand, a paradise in which nothing was ever contested. It was
detected and corrected by measurement. The sweep generalises that instinct into method.)*

---

## 3. "Institution detection is the hard, under-specified part"

**Fully accepted. Here is one concrete, falsifiable detector, with a null control.**

The review's challenge is exact: define the operational signature of money from raw events
*without smuggling the concept in*. The smuggling test is the hard part, so it is specified
first.

### Detector: CURRENCY

Run over **every** item type — the detector must never privilege ore, or the conclusion is
assumed. An item `M` is declared a currency in window `W` iff **all five** hold:

| # | Condition | Operationalisation | Why it's necessary |
|---|---|---|---|
| **C1** | **Non-consumption** | Zero `EAT`/`DRINK` events on `M` by any agent, ever | Money is wanted for what it buys, not for itself |
| **C2** | **Indirect exchange** | ≥ `k₁` transfer-pairs where A gives `M` to B and B gives a *consumable* to A within `Δt` ticks | `M` is exchanged *for* useful things |
| **C3** | **Acceptance breadth** | ≥ `k₂` **distinct** agents accept `M` in such a pair | Rules out a bilateral quirk between two agents |
| **C4** | **Re-spending (the acid test)** | An agent that *received* `M` subsequently *spends* `M` for a consumable within `W` | **`M` is held not for use, but for onward exchange.** This is the definition of money: it is accepted by someone who does not want it, because they know someone else will take it |
| **C5** | **Price stability** *(strong form)* | Variance of the `M`:consumable exchange ratio across distinct dyads < `θ` | A *price* exists — the market has agreed a rate |

**C4 is the load-bearing condition.** C1–C3 are consistent with mere barter. Only C4
distinguishes money from barter: a barterer accepts what they want; a money-user accepts what
they *don't* want, in confidence of onward acceptance. Nothing in the agent's prompt, verb
set, or world state names or describes this — it can only be observed in the pattern of
transfers.

### Null controls (this is what makes it science, not storytelling)

The detector is worthless unless it can be shown not to fire on noise or on non-money.

1. **Permutation null.** Randomly permute actor identities and timestamps within the event
   log, preserving marginal event counts, and re-run the detector across ≥ 1,000 permutations.
   **The false-positive rate must be < 5%.** If the detector fires on shuffled data, it is
   detecting nothing.
2. **Barter control.** Run an arm in which ore is made *edible*. The detector must **NOT**
   fire — ore is now consumed, so its exchange is barter, not currency. C1 excludes it and C4
   should fail. If it fires anyway, C4 is mis-specified.
3. **No-transfer control.** Run an arm with no exchange verb at all. The detector must never
   fire. (Trivial, but it catches implementation bugs.)
4. **Blind arm.** Run the detector over all three items. If it fires on *grain* — a
   consumable — the specification is broken. It should be structurally impossible via C1.

**Reporting.** Every claimed institution is reported with: the tick of crystallisation, the
discovering agents, the detector's parameter values, the permutation-null false-positive rate,
and the abundance level at which it fired. A claimed institution without a null rate is not a
result.

### Second detector: PROPERTY (sketch, same discipline)

A `CLAIM` on tile T is *respected* iff, using **difference-in-differences**: the rate of
gather-attempts by non-claimants on T falls after the claim, **relative to** matched
unclaimed control tiles over the same period. This controls for the obvious confound — that
the node simply ran out. Same permutation null applies.

---

## 4. The well-being proposal — accepted as **measurement**, rejected as **objective**

The suggestion: have agents optimise a multi-dimensional well-being score across personal,
economic, social, cultural, environmental, and political dimensions.

**As an objective function, this would invalidate the experiment**, for exactly the reason the
review itself identifies two paragraphs earlier. To instruct an agent to maximise "social" and
"economic" well-being is to install the concepts of *society* and *economy* into the agent
before the run begins — and then to "discover" them in the output. That is the smuggling the
review rightly warns against, in its purest form. It would also violate the project's founding
invariant (*the engine owns reality; agents only own opinions*) by making the engine's value
system the agent's value system.

**But inverted, the idea is excellent — and is adopted.** The six dimensions become the
project's **dependent variables**: a multi-dimensional outcome measure, computed by the
engine from observable state, never shown to agents, and never optimised for.

| Dimension | Observable proxy (from event log alone) | Never told to agents |
|---|---|---|
| **Personal** | mean satiation/hydration/health; survival rate; days above distress threshold | ✓ |
| **Economic** | exchange volume; specialisation index (Gini of gathering by item×agent); surplus held above subsistence | ✓ |
| **Social** | trust index (reciprocated exchanges ÷ exchange opportunities); aid rate to distressed agents; defection rate | ✓ |
| **Cultural** | concept diffusion — how many agents know a discovered concept, and how fast it spread via `TEACH` | ✓ |
| **Environmental** | node stock sustainability — is extraction below or above regen? (a commons-tragedy measure) | ✓ |
| **Political** | claim-respect rate; group formation; territorial stability; contract-keeping rate | ✓ |

This is strictly stronger than a survival count. It gives the scarcity sweep (§2) a
**six-dimensional outcome surface**, and it gives the multi-provider comparison (Phase 4) a
six-dimensional profile per model. The interesting result is no longer "who survived" but
**"which model produced which shape of society"** — a Claude world might score high on social
and low on economic; a GPT world the reverse. That is a genuinely novel finding and it exists
only because the dimensions are measured rather than optimised.

**The claim then becomes falsifiable in the right way:** *does well-being rise without anyone
being told to raise it?* If agents optimising only for their own survival nonetheless produce
a world scoring higher on the social and political dimensions than the heuristic-bot baseline
does, that is emergence — measured, not installed.

---

## 5. On the gap between substrate and claim

**Fully accepted, and it will be stated plainly in the writeup.**

What is currently demonstrated:

- A deterministic, event-sourced, replayable simulation substrate, with machine-checked
  guarantees (byte-identical replay; bounded perception proven non-leaking by differential
  testing with a positive control).
- A world tuned to a **competition-driven** regime: agents die at contested, depleted
  resources they *reached* (11/11 deaths by competition at seed 42), not from failing to find
  food — verified by death-cause forensics.
- Social memory: agents witness and remember each other's acts, with salience-weighted,
  logarithmically-decaying retention.
- **Heuristic agents — the control condition.** Not LLMs.

What is **not** demonstrated, and will not be claimed:

- That LLM agents invent institutions. The LLM layer (Phase 3) is not built.

The heuristic baseline is not a placeholder — it is the **control group**, frozen at tag
`phase-1` and archived across 20 seeds via `npm run research`. Every subsequent claim about
LLM agents will be reported as a delta against it, with seed-to-seed standard deviation, so
that "the agents did better" is a statistical statement rather than an impression.

---

## Summary of committed work

| # | Deliverable | Answers |
|---|---|---|
| 1 | `test:positive-sum` — machine-checked proof that specialise-and-exchange beats autarky | "Is the world capable of cooperation?" |
| 2 | Trustless (`TRANSFER`) vs. trustful (`DROP`/`GATHER`) exchange as an experimental arm | Positive-sum affordances — *and* whether models defect when they can |
| 3 | `research --sweep abundance` — 5 levels × 20 seeds, phase diagram | Scarcity as a confound |
| 4 | CURRENCY detector: C1–C5, with permutation null + barter control + blind arm | "Define money from raw events without smuggling it in" |
| 5 | PROPERTY detector via difference-in-differences on claim respect | Second institution |
| 6 | Six-dimensional well-being as **dependent variable**, never as objective | The well-being proposal, inverted |
| 7 | Frozen 20-seed heuristic baseline as the control group | The substrate/claim gap |
