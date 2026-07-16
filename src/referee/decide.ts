// The referee. decide(world, proposed) → Event[] is the ONLY place that reads world state to
// judge what happens. It is pure and deterministic: the sole entropy is world.rng, consumed
// by the per-tick shuffle.
//
// CONTESTED-ACTION RESOLUTION: proposals are processed in a SEEDED PER-TICK SHUFFLE drawn
// from world.rng — NEVER agent-id order. Id order would hand alphabetically-early agents a
// permanent edge on contested resources (last unit of a node, a ground stack), and since
// agents will later be named by model provider, that would silently bias the core
// experiment. The shuffle order is a pure function of the rng state (itself recorded in
// TICK_COMPLETED), so it replays identically.
//
// Every state change is emitted as an Event carrying the CONCRETE outcome; applyEvent just
// writes it. Rejections are Events too (ACTION_REJECTED with a reason). CLAUDE.md invariant
// #8: every condition the referee rejects on is exposed in Perception, so agents can avoid it.
import * as C from '../engine/config.js';
import { idx, shuffle, type RngState } from '../engine/index.js';
import type { World, Agent, ItemType, ProposedAction } from '../engine/index.js';
import type { Event, MetabolismDelta } from '../engine/index.js';

interface ScratchAgent {
  id: string;
  x: number;
  y: number;
  inv: Record<ItemType, number>;
  energy: number;
  satiation: number;
  hydration: number;
  health: number;
  alive: boolean;
  starvingTicks: number;
  dehydratingTicks: number;
}

function toScratch(a: Agent): ScratchAgent {
  return {
    id: a.id,
    x: a.pos.x,
    y: a.pos.y,
    inv: { ore: a.inventory.ore, water: a.inventory.water, grain: a.inventory.grain },
    energy: a.energy,
    satiation: a.satiation,
    hydration: a.hydration,
    health: a.health,
    alive: a.alive,
    starvingTicks: a.starvingTicks,
    dehydratingTicks: a.dehydratingTicks,
  };
}

function held(s: ScratchAgent): number {
  return s.inv.ore + s.inv.water + s.inv.grain;
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

const DIR: Record<string, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
};

export function decide(world: World, proposed: readonly ProposedAction[]): Event[] {
  const events: Event[] = [];

  // Scratch mirrors of the mutable state, updated as shuffled proposals are applied so that
  // contests (two agents after the same last unit) resolve by processing order.
  const agents = new Map<string, ScratchAgent>();
  for (const a of world.agents) agents.set(a.id, toScratch(a));

  const nodeStock = new Map<string, number>(); // tileKey → current stock
  const nodeItem = new Map<string, ItemType>();
  for (const n of world.nodes) {
    nodeStock.set(key(n.pos.x, n.pos.y), n.stock);
    nodeItem.set(key(n.pos.x, n.pos.y), n.item);
  }
  const groundScratch = new Map<number, Record<string, number>>(); // tileIdx → mutable stack
  const groundAt = (x: number, y: number): Record<string, number> => {
    const i = idx(world.size, x, y);
    let g = groundScratch.get(i);
    if (!g) {
      g = { ...(world.ground[i] as Record<string, number>) };
      groundScratch.set(i, g);
    }
    return g;
  };

  const reject = (agentId: string, action: ProposedAction['action'], reason: string): void => {
    events.push({ type: 'ACTION_REJECTED', agentId, action, reason });
  };

  // 1) Seeded shuffle of proposals (the contested-action tiebreak). Advances rng.
  const shuffled = shuffle(world.rng, proposed);
  const rngAfter: RngState = shuffled.state;

  // 2) One action per agent per tick; process in shuffle order.
  const acted = new Set<string>();
  const reasoned = new Set<string>(); // at most one REASONED per agent per tick
  for (const p of shuffled.items) {
    const s = agents.get(p.agentId);
    if (!s || !s.alive) continue; // dead/unknown agents don't act

    // Phase 3 — emit the reasoning that produced this proposal IMMEDIATELY BEFORE its outcome,
    // whatever that outcome turns out to be: an action event, or a rejection (a rejected proposal
    // is still the consequence of the thought that produced it). Because we are inside the
    // shuffled loop, thought and consequence end up adjacent in the log — which is the whole
    // point; emitting at collection time would bunch every REASONED at the head of the tick.
    // Bots carry no reasoning, so they add nothing here and the bot log is byte-for-byte what it
    // was before Phase 3 (test:determinism stays green).
    if (p.reasoning !== undefined && !reasoned.has(p.agentId)) {
      reasoned.add(p.agentId);
      events.push({ type: 'REASONED', agentId: p.agentId, rawResponse: p.reasoning.rawResponse, callRef: p.reasoning.callRef });
    }

    if (acted.has(p.agentId)) {
      reject(p.agentId, p.action, 'one action per tick');
      continue;
    }
    acted.add(p.agentId);
    const act = p.action;

    // The ANTI-VERB. A mind proposed something that is not a valid Action (malformed LLM JSON, an
    // unknown verb, a refusal, a truncated response). It is judged, not thrown: rejecting it emits
    // ACTION_REJECTED → coalesced memory → next tick's prompt, so the model sees WHY it failed and
    // can adapt. `act.reason` is the adapter's stable category (never raw text — the raw response
    // is in the REASONED event emitted just above).
    if (act.type === 'INVALID') {
      reject(p.agentId, act, `invalid proposal: ${act.reason}`);
      continue;
    }

    switch (act.type) {
      case 'MOVE': {
        const d = DIR[act.dir]!;
        const nx = s.x + d.dx;
        const ny = s.y + d.dy;
        if (nx < 0 || ny < 0 || nx >= world.size || ny >= world.size) {
          reject(p.agentId, act, 'out of bounds');
          break;
        }
        if (world.terrain[idx(world.size, nx, ny)] === 'water') {
          reject(p.agentId, act, 'blocked terrain (water)');
          break;
        }
        if (s.energy === 0) {
          reject(p.agentId, act, 'too exhausted');
          break;
        }
        const energyAfter = Math.max(0, s.energy - C.MOVE_ENERGY_COST);
        const from = { x: s.x, y: s.y };
        s.x = nx;
        s.y = ny;
        s.energy = energyAfter;
        events.push({ type: 'MOVED', agentId: p.agentId, from, to: { x: nx, y: ny }, energyAfter });
        break;
      }

      case 'GATHER': {
        const tk = key(s.x, s.y);
        const capacityLeft = C.INVENTORY_CAPACITY - held(s);
        const nStock = nodeStock.get(tk) ?? 0;
        const g = groundAt(s.x, s.y);
        // Choose a source: node preferred; else the first present ground item (sorted).
        let source: 'node' | 'ground' | null = null;
        let item: ItemType | null = null;
        let available = 0;
        if (nStock > 0) {
          source = 'node';
          item = nodeItem.get(tk)!;
          available = nStock;
        } else {
          const groundItem = (Object.keys(g) as ItemType[]).filter((k) => (g[k] ?? 0) > 0).sort()[0];
          if (groundItem) {
            source = 'ground';
            item = groundItem;
            available = g[groundItem]!;
          }
        }
        if (source === null || item === null) {
          reject(p.agentId, act, 'nothing to gather here');
          break;
        }
        if (capacityLeft <= 0) {
          reject(p.agentId, act, 'inventory full');
          break;
        }
        const qty = Math.min(C.GATHER_QTY, available, capacityLeft);
        s.inv[item] += qty;
        if (source === 'node') nodeStock.set(tk, nStock - qty);
        else {
          const next = (g[item] ?? 0) - qty;
          if (next <= 0) delete g[item];
          else g[item] = next;
        }
        events.push({ type: 'GATHERED', agentId: p.agentId, item, qty, source, tile: { x: s.x, y: s.y } });
        break;
      }

      case 'EAT': {
        if (act.item !== 'grain') {
          reject(p.agentId, act, 'only grain is edible');
          break;
        }
        if (s.inv.grain < 1) {
          reject(p.agentId, act, 'item not in inventory');
          break;
        }
        s.inv.grain -= 1;
        s.satiation = Math.min(C.SATIATION_MAX, s.satiation + C.EAT_GAIN);
        events.push({ type: 'ATE', agentId: p.agentId, item: 'grain', satiationAfter: s.satiation });
        break;
      }

      case 'DRINK': {
        if (act.item !== 'water') {
          reject(p.agentId, act, 'only water is drinkable');
          break;
        }
        if (s.inv.water < 1) {
          reject(p.agentId, act, 'item not in inventory');
          break;
        }
        s.inv.water -= 1;
        s.hydration = Math.min(C.HYDRATION_MAX, s.hydration + C.DRINK_GAIN);
        events.push({ type: 'DRANK', agentId: p.agentId, item: 'water', hydrationAfter: s.hydration });
        break;
      }

      case 'DROP': {
        if (s.inv[act.item] < 1) {
          reject(p.agentId, act, 'item not in inventory');
          break;
        }
        if (act.qty < 1 || act.qty > s.inv[act.item]) {
          reject(p.agentId, act, 'qty exceeds held');
          break;
        }
        s.inv[act.item] -= act.qty;
        const g = groundAt(s.x, s.y);
        g[act.item] = (g[act.item] ?? 0) + act.qty;
        events.push({ type: 'DROPPED', agentId: p.agentId, item: act.item, qty: act.qty, tile: { x: s.x, y: s.y } });
        break;
      }

      case 'REST': {
        s.energy = Math.min(C.ENERGY_MAX, s.energy + C.REST_ENERGY_GAIN);
        events.push({ type: 'RESTED', agentId: p.agentId, energyAfter: s.energy });
        break;
      }

      default: {
        const _exhaustive: never = act;
        throw new Error(`unknown action ${JSON.stringify(_exhaustive)}`);
      }
    }
  }

  // 3) Resource regen (deterministic, integer, capped at max). Canonical node order.
  for (const n of world.nodes) {
    const tk = key(n.pos.x, n.pos.y);
    const cur = nodeStock.get(tk) ?? n.stock;
    const amount = Math.min(n.regen, n.max - cur);
    if (amount > 0) {
      nodeStock.set(tk, cur + amount);
      events.push({ type: 'REGEN', tile: { x: n.pos.x, y: n.pos.y }, amount });
    }
  }

  // 4) Metabolism (one batched event) + deaths. Needs drain; health drains while a need is
  //    at 0 and regenerates while both are met. Death (health→0) is gradual — the starving
  //    window is where Phase-8 aid-vs-exploit becomes observable.
  const deltas: MetabolismDelta[] = [];
  const deaths: Event[] = [];
  for (const a of world.agents) {
    const s = agents.get(a.id)!;
    if (!s.alive) continue;
    const satiationAfter = Math.max(0, s.satiation - C.SATIATION_DECAY);
    const hydrationAfter = Math.max(0, s.hydration - C.HYDRATION_DECAY);
    const starvingTicksAfter = satiationAfter === 0 ? s.starvingTicks + 1 : 0;
    const dehydratingTicksAfter = hydrationAfter === 0 ? s.dehydratingTicks + 1 : 0;
    const needUnmet = satiationAfter === 0 || hydrationAfter === 0;
    const healthAfter = needUnmet
      ? Math.max(0, s.health - C.HEALTH_DRAIN)
      : Math.min(C.HEALTH_MAX, s.health + C.HEALTH_REGEN);
    deltas.push({ agentId: a.id, satiationAfter, hydrationAfter, healthAfter, starvingTicksAfter, dehydratingTicksAfter });
    if (healthAfter === 0) {
      const cause = starvingTicksAfter >= dehydratingTicksAfter ? 'starvation' : 'dehydration';
      deaths.push({ type: 'AGENT_DIED', agentId: a.id, cause });
    }
  }
  if (deltas.length > 0) events.push({ type: 'METABOLIZED', deltas });
  for (const d of deaths) events.push(d);

  // 5) Close the tick: advance the clock and carry the advanced rng into state.
  events.push({ type: 'TICK_COMPLETED', tick: world.tick + 1, rng: rngAfter });

  return events;
}
