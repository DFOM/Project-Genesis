# Project Genesis — Experiment Control
### Addendum to `docs/DESIGN.md` · the settings panel is the experiment designer

> **Framing rule.** Nothing here is a "preference." Every setting below is an **independent
> variable**. Each one is stamped into `config.json` next to the git SHA, echoed in
> `summary.md`, and carried as a column in `runs.csv`. A knob that isn't recorded is a
> confound waiting to happen.

---

## 0. The determinism consequence (read this first)

The engine's founding guarantee — *same seed ⇒ byte-identical world* — **does not survive
contact with an LLM.** Models are stochastic; the same seed will not reproduce the same run.

This is not a bug to fix, but it changes what a "run" is:

| Property | Phase 1–2 (bots) | Phase 3+ (LLMs) |
|---|---|---|
| **Replay from event log** | exact | **exact** — every LLM response is recorded in the log, so replay folds the same events |
| **Re-run from same seed** | identical | **divergent** — the model samples differently |

**Therefore: `seed` alone no longer identifies a run.** Two new axes are required:

- **`--seeds`** — controls the *world*: terrain, node placement, spawn positions.
- **`--replicates N`** — controls the *model's stochasticity*: N independent runs of the same
  seed and config.

**Every reported number is `mean ± sd` over `seeds × replicates`.** A single LLM run is an
anecdote, no matter how good the engine underneath it is. `test:determinism` continues to gate
the engine (bots only, no LLM) — it remains the proof that the *substrate* is sound.

---

## 1. Concept seeding — a four-state ladder, not a checkbox

"Economy: ON" is not a meaningful setting. What matters is *how much the agents were given*,
and there are four rungs. Each concept is set independently.

| State | What exists in the world | What agents are told | The question it asks |
|---|---|---|---|
| **`ABSENT`** | The affordance isn't in the world at all (no useless rock, no ball, no drum) | nothing | Control. The concept is *unreachable* — it must never be detected. A detector that fires here is broken. |
| **`AFFORDED`** | The raw material exists; nothing is explained | nothing | **Hard mode.** *Will they invent it?* ← the real experiment |
| **`SEEDED`** | Affordance exists | **One** agent is told the concept in its system prompt | *Will it spread?* Does culture transmit? |
| **`UNIVERSAL`** | Affordance exists | **Every** agent is told, at tick 0 | *What does a world do with it once it has it?* Skips discovery, studies consequences. |

```jsonc
"concepts": {
  "currency":      "AFFORDED",   // the useless ore exists; nobody knows what it's for
  "property":      "AFFORDED",
  "contract":      "ABSENT",     // PROMISE/AGREE verbs disabled entirely
  "music":         "AFFORDED",   // a drum exists in the world
  "sport":         "ABSENT",     // no ball is spawned
  "writing":       "SEEDED",     // one agent knows marks can persist
  "science":       "AFFORDED"
}
```

**Two hard rules:**

1. **`ABSENT` must disable the affordance, not just the label.** `contract: ABSENT` means the
   `PROMISE`/`AGREE` verbs are not in the action schema at all. Otherwise agents "discover"
   something you left lying in the verb list.
2. **`ABSENT` is the detector's null control.** If the CURRENCY detector fires in a world where
   no non-consumable item exists, the detector is measuring noise. Run this every time.

**Entertainment/music/sport need affordances, and this is where the ladder earns its keep.**
You cannot "turn on Sport." You can spawn a ball, give agents idle time (surplus — see
`abundance`), and let rivalry exist. Sport is then a *rule-bound contest that agents `DECLARE`
and repeat without `SEIZE`*. Whether that ever happens is precisely the experiment. `ABSENT`
removes the ball; `AFFORDED` puts it there and says nothing.

---

## 2. Agent roster — one key, many agents, and why that matters

One API key drives as many agents as you like — it's N calls with the same credential. There
is no technical obstacle. The **methodological** value is replication, and it changes what you
can claim.

```jsonc
"agents": [
  { "count": 6, "provider": "anthropic", "model": "claude-...",  "temperature": 1.0, "persona": "none" },
  { "count": 6, "provider": "openai",    "model": "gpt-...",     "temperature": 1.0, "persona": "none" },
  { "count": 6, "provider": "google",    "model": "gemini-...",  "temperature": 1.0, "persona": "none" },
  { "count": 6, "provider": "ollama",    "model": "llama-...",   "temperature": 1.0, "persona": "none" },
  { "count": 6, "provider": "heuristic", "model": "bot-v1" }      // the control group, in-world
]
```

### 2.1 Blind labelling — non-negotiable

Agents are named from a neutral pool (`Otis`, `Wren`, `Marisol`, …). **The model behind an
agent is never visible in perception, memory, or any prompt.** The mapping lives in
`config.json` and is joined at analysis time.

Without this, you are not measuring "how does GPT behave" — you are measuring "how do models
treat an entity labelled GPT," which is a completely different (and much less interesting)
experiment. This control is free. Take it.

### 2.2 Two population designs, two different questions

| Design | Composition | Question | Independence |
|---|---|---|---|
| **Monoculture** | One world per model, same seed (all-Claude world; all-GPT world; all-bot world) | *What kind of society does each model build, unmolested?* | Runs are independent → **clean between-model comparison** |
| **Mixed** | All models in one world, blind-labelled | *How do they treat each other?* | Agents interact → **not** independent samples |

**Run both. They answer different things, and conflating them is the easiest mistake here.**

The mixed arm buys you a question nobody has asked: **do agents favour their own kind?**
Compute an *in-group bias index* — the rate of `GIVE`/`TRANSFER`/aid directed at same-model
agents versus other-model agents, normalised by encounter frequency. Since labels are blind, a
same-model preference could only arise from **behavioural** affinity (similar policies
recognising each other) rather than from reading a name tag. That would be a genuinely novel
result, and the design that produces it costs you nothing extra.

### 2.3 Statistics

- Unit of analysis: **the agent** (`agents.csv`), with a `provider`/`model` column.
- Between-model claims require **monoculture arms** × ≥ 5 seeds × ≥ 3 replicates.
- Report `mean ± sd`. **A between-model difference smaller than the within-model sd is not a
  finding.** State this explicitly in the writeup; it's the sentence that separates this from
  every "we watched the agents and they seemed to cooperate" paper.
- Same-model agents in a *mixed* world are **not** independent — use them for interaction
  effects only, never for a clean model comparison.

---

## 3. The full control surface

### World
| Setting | Range | Why it's an IV |
|---|---|---|
| `worldSize` | 16–128 | Density. Small = constant encounters; large = isolation. **Directly governs whether society is possible at all.** |
| `agentCount` | 2–100 | With `worldSize`, sets density — arguably the single most important variable in the project |
| `abundance` | 0.25–4.0 | Scalar over node count × stock × regen. **The scarcity sweep (see review response §2).** |
| `resourceLayout` | `split` \| `uniform` \| `random` | `split` (grain east / water south) creates comparative advantage; `uniform` destroys the gains from trade. **The direct test of whether specialisation drives exchange.** |
| `disasters` | off \| drought \| blight \| flood | Phase 8. A social instrument (aid vs. exploit), never a mortality knob. |

### Agents
| Setting | Range | Why it's an IV |
|---|---|---|
| `perceptionRadius` | 2–16 | Does seeing more produce more cooperation — or more conflict? |
| `memoryCapacity` | 0–100 | **Set to 0 for the amnesia arm.** If cooperation collapses without memory, you've proven reputation is load-bearing. |
| `memoryDecay` | 0–∞ | Do agents that forget slowly hold grudges? Does that help or hurt? |
| `persona` | `none` \| `minimal` \| `rich` | Does giving them a self change the society? (`none` is the cleanest baseline.) |
| `temperature` | 0–1 | Sampling spread. Log it always. |

### Verbs — the ablation panel
Each verb independently on/off. **This is the cleanest causal instrument in the whole project:
remove one affordance, hold everything else fixed, and measure what disappears.**

| Ablation | Turn off | What it tests |
|---|---|---|
| **No voice** | `SPEAK` | Does trade still happen without language? (It can — via `DROP`/`GATHER`.) |
| **No coercion** | `SEIZE`, `STRIKE`, `BLOCK` | Does cooperation rise when defection by force is impossible — or was violence never the obstacle? |
| **No memory** | `memoryCapacity: 0` | Is reputation what makes trust work? |
| **Trustless exchange** | atomic `TRANSFER` on, `DROP`/`GATHER` exchange off | Do agents exchange more when they *cannot* be cheated? |
| **Trustful exchange** | atomic `TRANSFER` off | **Do they exchange anyway, when betrayal is free?** ← the good one |

### Run
| Setting | Notes |
|---|---|
| `seeds` | Controls the world |
| `replicates` | Controls LLM stochasticity — **required** for any LLM claim |
| `ticks` | Run length |
| `budgetCapUSD` | **Hard stop.** Auto-pauses the sim. Non-negotiable for overnight runs. |
| `thinkPolicy` | `every-tick` \| `urgency-gated` \| `two-tier` — see DESIGN §7. Governs cost. |

---

## 4. Presets — because twenty sliders invite p-hacking

A panel with twenty knobs invites you to fiddle until a story appears. Ship **named
experiments** with pre-registered hypotheses instead:

| Preset | Config | Hypothesis (declared *before* the run) |
|---|---|---|
| `baseline-bots` | heuristics, 20 seeds | The control. Frozen at tag `phase-1`. |
| `first-minds` | 6 agents, one model, all concepts `AFFORDED` | LLM agents outlive the bot baseline by > 1 sd |
| `scarcity-sweep` | abundance ∈ {0.25…4.0} × 20 seeds | Institutions emerge only in the contested band |
| `monoculture-compare` | 4 single-model worlds, same seeds | Models produce different well-being *profiles* |
| `in-group` | mixed, blind-labelled | Same-model aid rate > cross-model aid rate |
| `trust` | trustful vs trustless exchange | Exchange volume is *lower* but reputation forms when defection is possible |
| `amnesia` | `memoryCapacity: 0` | Cooperation collapses without memory |
| `no-voice` | `SPEAK` off | Trade survives the loss of language |

**Declare the hypothesis in the preset file, before running it.** It costs nothing and it is
the difference between a result and a story you found afterwards.

---

## 5. Implementation notes

- **Config is a single JSON object**, versioned, hashed, and written to
  `research/<label>/config.json` alongside the git SHA. Two charts that can't be traced back
  to their configs are two rumours.
- **The settings UI is generated from the config schema** — one source of truth, so a new knob
  can't exist in the engine while being invisible in the panel (or vice versa).
- **Validation on load:** reject impossible configs loudly. `agentCount > passableTiles`,
  `currency: AFFORDED` with no non-consumable item, `TRANSFER` off *and* `DROP` off (no
  exchange is possible at all → cooperation is foreclosed by construction, which is a valid
  arm but must be **stated**, never stumbled into).
- **Cost estimate before launch:** `agents × ticks × thinkRate × tokensPerCall × price`, shown
  in the UI before the run starts, with the budget cap enforced during. `--replicates 5` on a
  4-model mixed world is **20× the cost of a single run.** The number should be on screen
  before you press the button, not on the invoice afterwards.
