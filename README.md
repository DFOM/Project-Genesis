# 🌍 Project Genesis

> **A deterministic civilization sandbox where AI agents from multiple providers may—or may not—invent society.**

Project Genesis is a desktop simulation that explores one fundamental research question:

> **Given scarcity, memory, communication, and no predefined social rules, will autonomous AI agents independently develop trade, property, money, governments, borders, alliances, and conflict?**

Unlike traditional simulations, agents **never control reality directly**. They can only perceive the world, remember experiences, communicate, and propose actions. A deterministic simulation engine decides what actually happens.

---

## 🎥 Overview

Genesis combines:

- 🧠 Multiple AI models (OpenAI, Anthropic, Google, xAI, DeepSeek, Ollama)
- ⚖️ Deterministic simulation engine
- 📜 Event-sourced world history
- 🗺️ Emergent civilizations
- 🏛️ Automatic detection of institutions
- 💾 Full replayability

Instead of scripting civilizations, Genesis asks a simple question:

> *If intelligent agents are placed into a world with limited resources and no instructions, what kind of society naturally emerges?*

---

# Core Philosophy

## The Engine Owns Reality

The single most important design principle:

> **The engine owns reality. Agents only own opinions.**

Agents cannot:

- Create resources
- Modify world state
- Spawn items
- Declare ownership
- Invent money
- Create countries

Instead they:

- Observe
- Think
- Remember
- Communicate
- Propose actions

Every proposal is evaluated by a deterministic **Referee** before becoming part of the simulation.

---

# Research Goal

Genesis is designed as an experiment rather than a game.

The central hypothesis is:

> **Can large language models independently invent civilization when given only basic survival mechanics?**

The project investigates whether different AI models naturally converge on concepts such as:

- Property
- Trade
- Currency
- Cooperation
- Leadership
- Alliances
- Borders
- Laws
- Conflict
- Diplomacy

without any of these concepts existing inside the engine.

---

# Features

## Deterministic Simulation

- Pure simulation engine
- Seeded randomness
- Replayable worlds
- Identical outcomes from identical seeds

---

## Event-Sourced World

Everything that happens is recorded as events.

Instead of storing the current world, Genesis stores:

```
Gathered Wood
Built Shelter
Traded Food
Created Agreement
Conflict Began
```

The current world is reconstructed by replaying the event history.

This enables:

- Replay
- Time travel
- Save states
- Branching timelines
- Debugging
- Research analysis

---

## Multi-Provider AI

Genesis is designed to support multiple AI providers through a unified interface.

Planned providers include:

- OpenAI
- Anthropic
- Google Gemini
- xAI
- DeepSeek
- Ollama (local models)

Each agent can use a different model, allowing direct comparisons of emergent behavior.

---

## Emergent Institutions

Nothing is hardcoded.

The simulation never contains variables like:

```
money = true
nation = true
government = monarchy
```

Instead, these concepts are detected from behavior.

If agents repeatedly exchange one resource for another, Genesis may identify the emergence of:

- Currency
- Property
- Markets
- Governments
- Borders
- Social hierarchies

---

## Limited Perception

Every agent only knows what it can realistically observe.

Agents can see:

- Nearby terrain
- Nearby agents
- Local resources
- Their inventory
- Personal memories

Agents **cannot** see:

- Global map
- Hidden resources
- Other inventories
- Internal simulation state
- Future events

---

## Deterministic Referee

Every action is validated.

Example:

```
Agent:
"I pick up the stone."

↓

Referee:
✓ Accepted
```

or

```
Agent:
"I gather wood."

↓

Referee:
✗ Rejected

Reason:
No trees within gathering range.
```

The referee guarantees consistency regardless of which AI produced the action.

---

# Architecture

```
Electron
│
├── React Renderer
│
├── Orchestrator
│
├── AI Runtime
│
├── Referee
│
├── Simulation Engine
│
└── SQLite Event Store
```

---

# Technology Stack

| Component | Technology |
|-----------|------------|
| Desktop | Electron |
| Frontend | React |
| Language | TypeScript |
| Build Tool | Electron Vite |
| Storage | SQLite |
| Testing | Vitest |
| Packaging | Electron Builder |

---

# Project Structure

```
src/
│
├── agents/
│   AI providers and heuristic bots
│
├── engine/
│   Pure deterministic simulation
│
├── referee/
│   Action validation
│
├── orchestrator/
│   Tick scheduling and execution
│
├── store/
│   SQLite event storage
│
├── ui/
│   React interface
│
└── preload/
    Electron IPC bridge

docs/
└── DESIGN.md
```

---

# Installation

Clone the repository

```bash
git clone https://github.com/DFOM/Project-Genesis.git
cd Project-Genesis
```

Install dependencies

```bash
npm install
```

Run in development

```bash
npm run dev
```

Build production

```bash
npm run build
```

Create desktop installers

```bash
npm run dist
```

---

# Running Tests

Run all tests

```bash
npm test
```

Determinism tests

```bash
npm run test:determinism
```

Simulation balance tests

```bash
npm run test:balance
```

Scarcity tests

```bash
npm run test:scarcity
```

---

# Headless Simulation

Run a simulation without the UI.

```bash
npm run sim:headless
```

Example

```bash
npm run sim:headless -- --seed 42 --ticks 5000
```

Useful for benchmarking and research experiments.

---

# Design Principles

- Engine owns reality
- Agents own opinions
- Event sourcing over mutable state
- Determinism over convenience
- Emergence over scripting
- Research before gameplay

---

# Roadmap

## Phase 0

- Project setup
- Simulation engine
- Deterministic world

## Phase 1

- Resources
- Movement
- Gathering
- Hunger
- Mortality

## Phase 2

- Heuristic agents
- Event replay
- Referee system

## Phase 3

- LLM integration
- Multi-provider support
- Memory

## Phase 4

- Communication
- Alliances
- Trading

## Phase 5

- Emergent institutions
- Property
- Currency
- Borders
- Diplomacy

## Phase 6

- Research tools
- Analytics
- Visualization
- Civilization comparison

---

# Why Genesis?

Most AI simulations script civilizations.

Genesis asks whether civilization can emerge naturally.

Instead of programming:

- Governments
- Economies
- Wars
- Trade

Genesis only provides:

- Resources
- Space
- Memory
- Communication
- Survival

Everything else must emerge from the interactions between autonomous agents.

---

# Contributing

Contributions are welcome.

Before making significant architectural changes, please read:

```
docs/DESIGN.md
```

The simulation follows one non-negotiable rule:

> **The engine owns reality. Agents only own opinions.**

---

# License

This project is currently unlicensed.

Please add an appropriate open-source license before public distribution.

---

## Inspiration

Project Genesis draws inspiration from:

- Artificial Life (ALife)
- Multi-Agent Systems
- Emergent Behavior Research
- Agent-Based Modeling
- Evolutionary Computation
- Large Language Model Agents
- Complex Systems Theory

---

## Future Vision

Genesis aims to become a research platform for studying emergent intelligence and social organization, allowing researchers and developers to compare how different AI models behave under identical environmental constraints.

*"Civilization is not programmed—it emerges."*
