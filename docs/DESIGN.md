# GENESIS — Design & Build Plan
### A local desktop civilization sandbox where multi-provider AI agents may or may not invent society

---

## 0. The one rule

> **The engine owns reality. The agents only own opinions.**

Everything downstream depends on this. Agents never mutate the world directly. They *propose* actions; a deterministic referee validates them against world state and either applies them or rejects them with a reason. If an agent claims to own the northern hills, that claim is worth exactly nothing until the engine records a `CLAIM` that survived contest.

Without this, you get six chatbots narrating a civilization that doesn't exist.

---

## 1. What we are actually testing

The product is an experiment with a falsifiable question:

> *Given scarcity, memory, communication, and no instructions — do LLM agents converge on trade, money, property, groups, borders, and conflict? And does the answer differ by model?*

Every design decision below serves that question. If a feature doesn't make the answer clearer, cut it.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────┐
│  ELECTRON SHELL  (packaging → .dmg / .exe, keychain)     │
├──────────────────────────────────────────────────────────┤
│  RENDERER (React + Canvas)                               │
│  map · codex · mind feed · relationship graph ·          │
│  chronicle · agent roster · cost meter · pause/reset     │
├──────────────────────────────────────────────────────────┤
│  ORCHESTRATOR (Node/TS)                                  │
│    tick loop · scheduling · budget guard                 │
│                                                          │
│  ┌────────────┐   propose    ┌──────────────┐            │
│  │ AGENT      │ ───────────► │ REFEREE      │            │
│  │ RUNTIME    │ ◄─────────── │ (validator)  │            │
│  │ (LLM)      │   reject/ok  └──────┬───────┘            │
│  └────────────┘                     │ apply              │
│        ▲                            ▼                    │
│        │ perceive            ┌──────────────┐            │
│        └──────────────────── │ SIM ENGINE   │            │
│                              │ pure, det.   │            │
│                              └──────┬───────┘            │
│                                     ▼                    │
│                              ┌──────────────┐            │
│                              │ EVENT STORE  │  SQLite    │
│                              │ append-only  │  replay    │
│                              └──────────────┘            │
├──────────────────────────────────────────────────────────┤
│  PROVIDER ADAPTERS: Anthropic · OpenAI · Google ·        │
│  xAI · DeepSeek · Ollama (local, free)                   │
└──────────────────────────────────────────────────────────┘
```

**Why Electron:** you need Node for provider SDKs, SQLite, and OS keychain, and `electron-builder` gives you `.dmg` + `.exe` + auto-update for free. *Alternative:* Tauri v2 — 10× smaller binaries, but you'll be writing Rust. Pick Electron unless you want to learn Rust.

**Why event-sourced:** pause, reset, replay, and **fork-from-tick-N** all fall out for free. You will want to rerun era 40 with one variable changed. Store *events*, derive state.

**Determinism:** the engine must be a pure function `(state, action[]) → state`. Seeded RNG. The only non-determinism in the system is the LLM, and every LLM output is recorded in the event log — so a replay is exact.

---

## 3. The world substrate

Civilization needs three engines. Miss one and you get a chat room.

| Engine | Why | Implementation |
|---|---|---|
| **Scarcity** | Nothing has value if nothing runs out | Resource nodes with regen rates, finite stock, uneven geographic distribution |
| **Mortality** | No stakes, no strategy | Hunger, energy, injury. Agents can die. Dead agents stay dead. |
| **Persistence** | Yesterday must constrain today | Inventories, structures, terrain changes, and memory all outlive the tick |

**Deliberately uneven map.** Put ore in the north, water in the south, grain in the east. If every region is self-sufficient, trade never happens and neither does anything downstream of trade.

**Perception radius is non-negotiable.** An agent sees: its tile + N tiles around it, agents present, its own inventory, its own memory. It does **not** see global state, other agents' inventories, or the event log. No private information → no lying, no bargaining, no trust, no betrayal, no politics.

---

## 4. Action primitives (the whole verb list)

Keep this list small and physical. Institutions are *emergent combinations* of these — not entries in it.

**Physical:** `MOVE` `GATHER` `EAT` `DROP` `CRAFT` `BUILD` `REST`
**Social:** `SPEAK(to, text)` `TRANSFER(to, item)` `TEACH(to, concept)`
**Assertive:** `CLAIM(tile)` `PROMISE(to, terms)` `DECLARE(text)` `AGREE(promiseId)`
**Coercive:** `SEIZE(from, item)` `BLOCK(tile)` `STRIKE(agent)` `DEFEND`
**Aid:** `GIVE(to, item)` `HEAL(agent)` `SHARE(location, info)`

That's it. **Money is not a verb. Nations are not a verb. War is not a verb.** They are patterns the engine *detects* in sequences of these verbs.

> Note on coercion: keep it economic and territorial (seize resources, block passage, contest tiles), abstract not graphic. You want geopolitics, not gore.

---

## 5. The Concept Engine ← *this is your product*

A **Concept** is a latent node with hidden preconditions. Nobody is told it exists. The engine watches the event stream, and when a pattern fires, the concept **crystallizes**: it gets a name, a discoverer, a timestamp, and — critically — it becomes **teachable**, so it can spread through the population via `TEACH`.

```ts
type Concept = {
  id: string;
  name: string;            // assigned on discovery
  detect: (log: Event[], state: World) => Discovery | null;
  requires: string[];      // prerequisite concepts
  unlocks: Verb[];         // new affordances granted to knowers
};
```

**Example detectors:**

| Concept | Fires when | Unlocks |
|---|---|---|
| **Barter** | A `TRANSFER` pair between two agents within N ticks | — |
| **Value** | The same item is bartered by 3+ distinct agents | — |
| **Currency** | An item with no consumption use appears in ≥5 trades as the middle leg | `PRICE(item, n)` |
| **Property** | A `CLAIM` is respected (uncontested) for 20 ticks | `RENT`, `SELL` |
| **Contract** | A `PROMISE` is `AGREE`d and then *kept* | `ENFORCE` |
| **Debt** | A `TRANSFER` occurs against a future `PROMISE` | `INTEREST` |
| **Group** | 3+ agents co-locate and `AGREE` to a shared `DECLARE` | `MEMBER`, `EXPEL` |
| **Territory** | A Group holds contiguous `CLAIM`s | `BORDER` |
| **Nation** | A Territory + a Contract + a name in a `DECLARE` | `TREATY`, `TAX` |
| **War** | Two Groups exchange `SEIZE`/`STRIKE` across a Border | `PEACE` |
| **Peace** | A `PROMISE` between warring Groups is kept 20 ticks | — |
| **Craft** | Two items combined into a third | `RECIPE` |
| **Music** | A repeated non-utility action sequence performed near others | `PERFORM` |
| **Sport** | A rule-bound contest (`DECLARE`d rules + repeated contest + no `SEIZE`) | — |
| **Science** | An agent `DECLARE`s a prediction and it later verifies | `EXPERIMENT` |
| **Writing** | An agent stores text on a persistent object | `RECORD` (memory that survives death) |

**Discovery is a spotlight moment.** When a concept crystallizes: pause the tick, flash the map, log it to the **Codex** — *"TICK 412 — CURRENCY. Discovered by Kestrel-GPT4o. The salt has become money."* This is what people will screenshot.

**Concept spread = culture.** Track who knows what. A concept that dies with its discoverer is a tragedy the sim can actually produce. `Writing` is the concept that stops that from happening — which is a genuinely beautiful thing for your sim to be able to demonstrate.

### Seeding modes (build both — this is your A/B)

| Mode | What you plant | Question it answers |
|---|---|---|
| **Hard (affordance)** | A shiny useless rock. A drum. A ball. Idle time. | Will they *invent* it? |
| **Soft (concept)** | The concept "Currency," granted to one agent | Will it *spread*, and what does it do to the world? |
| **Blank** | Nothing but terrain and hunger | Baseline. Do they get anywhere at all? |

The comparison between these three runs *is* the research.

---

## 6. Agents & multi-provider

```ts
type AgentSpec = {
  name: string;              // dropdown of known models, or type your own
  provider: 'anthropic' | 'openai' | 'google' | 'xai' | 'deepseek' | 'ollama';
  model: string;
  apiKeyRef: string;         // OS keychain reference — NEVER in the DB
  persona?: string;          // optional; blank persona is a valid experiment
  spawnTick: number;         // "add them in the middle" — supported
  color: string;
};
```

- **Keys live in the OS keychain** (`safeStorage` / keytar), never in SQLite, never in the event log, never in a config file you might commit.
- **Adapter interface:** every provider normalizes to `propose(perception) → Action[]`. One interface, N adapters. Add a provider without touching the engine.
- **Ollama support is worth it** — free local models let you run 50-agent worlds and long histories at zero cost, then rerun the interesting seed with expensive models.
- **Mid-run spawning:** new agents arrive knowing nothing. An immigrant with no concepts is an excellent stress test of whether the culture can teach.
- **Model attribution in every event.** Then the Chronicle panel can tell you: *trades initiated by provider*, *promises broken by provider*, *concepts discovered by provider*, *survival rate by provider*. **This is your headline chart.** Nobody else has it.

---

## 7. Cost control (read this before you buy any API credits)

Naive design: 20 agents × 1 call/tick × 3k tokens × 1000 ticks = **60M tokens**. That is a real bill.

Do all of these:

1. **Not everyone thinks every tick.** Agents have an `urgency` score (hunger, threat, novelty, someone spoke to them). Only the top K think per tick. A resting agent costs $0.
2. **Two-tier minds.** Routine actions (`MOVE`, `GATHER`, `EAT`) go to a cheap/small model. Deliberation (`PROMISE`, `DECLARE`, `SEIZE`, teaching) goes to the expensive one. Route by action class.
3. **Compress memory.** Cap raw memory at ~10 events; every 50 ticks, roll older memory into a summary *using the cheap model*. Agents carry a paragraph of "who I am and what happened to me," not a transcript.
4. **Batch perception.** Perception is a compact struct, not prose. Tokens are the budget.
5. **Hard budget guard.** A live $ meter in the UI and a configurable cap that auto-pauses the sim. Non-negotiable — it's an overnight-run app.
6. **Dry-run mode.** Heuristic bot agents (no LLM) so you can test the engine for thousands of ticks for free. You will use this constantly.

---

## 8. UI

- **Map** — top-down, tiles, agents, structures, resource nodes, and **border overlays** once Territory exists.
- **Codex** — the discovery tree. What's been invented, by whom, when, and how far it's spread. The emotional center of the app.
- **Mind Feed** — thoughts (grey) + speech (quoted) + rejected actions (red). *Show the rejections.* Watching an agent try to seize something and fail is how you see the rules bite.
- **Chronicle** — every 100 ticks, a cheap model writes a short history of the era. Turns 4 hours of ticks into a readable story.
- **Ledger** — who owns what, who owes whom, current prices if Currency exists.
- **Roster** — agents, models, cost each, alive/dead.
- **Controls** — Play / Pause / Step / Speed / **Reset** / **Fork from tick N** / Seed editor.

---

## 9. Build plan — one Claude Code session per phase

Each phase has a **done test**. Don't advance until it passes.

| # | Phase | Deliverable | Done test |
|---|---|---|---|
| **0** | Skeleton | Electron + React + TS + SQLite + tick loop. No agents. | App opens, ticks increment, clock runs, Pause/Reset work. |
| **1** | **Engine** | Map, resources, hunger, inventories, the physical verbs, referee, event store. **Heuristic bots only — zero LLM.** | 30 dumb bots run 5,000 ticks. Some starve. Some survive. State is deterministic on replay from the same seed. |
| **2** | Perception & memory | Perception structs, memory, memory summarization. Still no LLM. | Perception snapshot for agent X contains *only* what X can see. Verified by test. |
| **3** | One mind | Anthropic adapter. Agents propose JSON actions; referee validates and returns rejection reasons. | 6 Claude agents survive longer than the heuristic baseline. If they don't, the perception format is bad — fix it here, not later. |
| **4** | Many minds | Provider adapter layer + OpenAI/Google/Ollama + keychain + roster UI + cost meter + mid-run spawn. | Mixed-provider world runs. Cost meter is accurate. Budget cap pauses the sim. |
| **5** | Society | `SPEAK`, `TRANSFER`, `GIVE`, relationships, reputation. | Two agents complete an unprompted trade. Screenshot it. |
| **6** | **Concept engine** | Detectors, crystallization, Codex UI, `TEACH` and spread, seed editor (hard/soft/blank). | Barter → Value → **Currency** fires without being seeded. This is the make-or-break phase. |
| **7** | Institutions | `CLAIM`, `PROMISE`/`AGREE`, groups, territory, borders, treaties, tax. | A border appears on the map that no one coded. |
| **8** | Conflict & aid | `SEIZE`, `BLOCK`, `STRIKE`, `DEFEND`, `HEAL`, disaster events (drought, blight, flood). | A disaster hits one region. Log whether the others aid or exploit. Compare by provider. |
| **9** | Chronicle & science | Era summaries, replay viewer, fork-from-tick, CSV export of every event. | Export a run and chart trades-per-era by model. |
| **10** | Ship | electron-builder → `.dmg` (signed/notarized) + `.exe`, onboarding for API keys, sample seeds. | Someone who isn't you installs it and gets a world running in under 3 minutes. |

**Phase 1 is the phase everyone skips and it is the phase that decides whether this works.** A world that is interesting when driven by *dumb* agents will be extraordinary when driven by smart ones. A world that's boring with dumb agents will be boring with GPT-5 — you'll just pay more for the boredom.

---

## 10. Failure modes to design against

| Risk | Symptom | Countermeasure |
|---|---|---|
| **Theater** | Agents *talk* about an economy that doesn't exist in state | Referee rejects unbacked actions. Nothing is true until the engine says so. |
| **Sycophancy soup** | Everyone is nice, nothing happens, forever | Real scarcity, private info, asymmetric goals, mortality, limited perception |
| **Roleplay collapse** | Agents mention being AIs, or narrate the simulation | Hard persona rules + strip meta-language in the referee layer |
| **Context bloat** | Cost explodes at tick 300 | Memory summarization; perception structs not prose |
| **Convergent mush** | Agents from all providers behave identically | Vary personas, starting resources, *and* geography. Log by provider to see if it's real. |
| **Nothing emerges** | Tick 2,000, still just eating | That is a **result**, not a bug. Run the seeded arm and compare. |

---

## 11. First prompt to give Claude Code

> Build Phase 0 + 1 of GENESIS: an Electron + React + TypeScript desktop app with a deterministic, event-sourced civilization simulation engine backed by SQLite.
>
> **No LLM integration in this phase.** Agents are heuristic bots (eat when hungry, gather when idle, wander otherwise).
>
> Requirements:
> - 64×64 tile world, seeded RNG, terrain types, resource nodes with finite stock and regen rates, **unevenly distributed** (ore north, water south, grain east).
> - Agents with position, inventory, hunger, energy, health. They can die.
> - Verbs: MOVE, GATHER, EAT, DROP, REST.
> - Pure engine: `step(state, actions[]) → {state, events[]}`. No side effects.
> - Referee validates every proposed action against state; invalid actions are rejected with a reason and logged.
> - Append-only SQLite event store. Full state is derivable by replaying events from tick 0.
> - Canvas map view, tick counter, Play/Pause/Step/Speed/Reset.
> - Fork-from-tick-N.
>
> Done test: 30 bots run 5,000 ticks; some starve; replaying the event log from the same seed reproduces the identical final state, byte for byte.

Ship that, confirm the replay determinism, and then we design the perception format together — that's the single highest-leverage thing in the whole build, because it's the entire universe from inside an agent's head.
