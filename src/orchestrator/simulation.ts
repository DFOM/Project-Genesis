// The orchestrator. It owns the tick loop, the agents' minds, and the event store. It is
// NOT pure — it may read a clock/timer for pacing (the engine may not). Determinism lives
// entirely below it: it only chooses WHICH proposals to collect and hands them to the
// referee, which is where all rules and the seeded rng live.
import { perceive, serialize } from '../engine/index.js';
import type { World, ProposedAction, Event, Mind, RunConfig } from '../engine/index.js';
import { step } from '../referee/index.js';
import { applyEvent } from '../engine/index.js';
import type { EventStore } from '../store/index.js';

export class Simulation {
  world: World;
  readonly runId: string;
  private readonly store: EventStore;
  private readonly minds: Map<string, Mind>;

  private constructor(runId: string, world: World, store: EventStore, minds: Map<string, Mind>) {
    this.runId = runId;
    this.world = world;
    this.store = store;
    this.minds = minds;
  }

  // Create a fresh run: emit GENESIS (the full constructor), persist it, build the world,
  // then bind one Mind to each agent the world actually contains.
  static create(runId: string, config: RunConfig, store: EventStore, mindFor: (agentId: string) => Mind): Simulation {
    const genesis: Event = { type: 'GENESIS', config };
    const world = applyEvent(null, genesis);
    store.append(runId, 0, [genesis]);
    const minds = new Map<string, Mind>();
    for (const a of world.agents) minds.set(a.id, mindFor(a.id));
    return new Simulation(runId, world, store, minds);
  }

  // Continue an existing run (e.g. after fork-from-tick-N) WITHOUT emitting a new GENESIS.
  // `world` is the replayed state at the fork point; subsequent events append to `runId`.
  static resume(runId: string, world: World, store: EventStore, mindFor: (agentId: string) => Mind): Simulation {
    const minds = new Map<string, Mind>();
    for (const a of world.agents) minds.set(a.id, mindFor(a.id));
    return new Simulation(runId, world, store, minds);
  }

  private async collectProposals(): Promise<ProposedAction[]> {
    // Gather in canonical (id) order; the referee shuffles for fairness, so this order does
    // not affect outcomes — it only needs to be deterministic.
    const proposals: ProposedAction[] = [];
    for (const a of this.world.agents) {
      if (!a.alive) continue;
      const mind = this.minds.get(a.id);
      if (!mind) continue;
      const actions = await Promise.resolve(mind.propose(perceive(this.world, a.id)));
      for (const action of actions) proposals.push({ agentId: a.id, action });
    }
    return proposals;
  }

  async stepOnce(): Promise<Event[]> {
    const proposals = await this.collectProposals();
    const result = step(this.world, proposals);
    this.world = result.world;
    // Tag the batch with the resulting tick so fork(N) reconstructs state at tick N.
    this.store.append(this.runId, this.world.tick, result.events);
    return result.events;
  }

  async run(ticks: number): Promise<void> {
    for (let i = 0; i < ticks; i++) await this.stepOnce();
  }

  aliveCount(): number {
    return this.world.agents.filter((a) => a.alive).length;
  }

  deadCount(): number {
    return this.world.agents.filter((a) => !a.alive).length;
  }

  serialized(): string {
    return serialize(this.world);
  }
}
