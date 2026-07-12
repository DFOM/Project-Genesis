// applyEvent — the SINGLE place world state ever changes. Both live simulation and replay
// fold this exact reducer over the exact same events, so replay equality is structural, not
// coincidental. The reducer is deterministic and does no I/O and no rng draws — it only
// WRITES the concrete outcomes the referee already computed into each event.
//
// PURITY NOTE: "pure" here means deterministic + no I/O + no clock/Math.random (CLAUDE.md
// invariant #1) — NOT immutability. For a 5,000-tick run we mutate the working World in
// place and return it (deep-cloning 4,096-tile arrays per event would be pathologically
// slow). Determinism is unaffected: live and replay each fold their own World object from
// their own GENESIS, and serialize() compares the results.
//
// GENESIS is the ONLY event that accepts a null world — it constructs the whole thing. Every
// other event asserts a non-null world. No `as World` casts anywhere.
import { buildWorld } from './genesis.js';
import { idx } from './types.js';
import type { Agent, Ground, ResourceNode, World } from './types.js';
import type { ItemType } from './contract.js';
import type { Event } from './events.js';

function requireWorld(world: World | null, type: string): World {
  if (world === null) throw new Error(`event ${type} arrived before GENESIS constructed the world`);
  return world;
}

function agent(world: World, id: string): Agent {
  const a = world.agents.find((x) => x.id === id);
  if (!a) throw new Error(`unknown agent ${id}`);
  return a;
}

function nodeAt(world: World, x: number, y: number): ResourceNode {
  const n = world.nodes.find((nn) => nn.pos.x === x && nn.pos.y === y);
  if (!n) throw new Error(`no node at (${x},${y})`);
  return n;
}

function addGround(g: Ground, item: ItemType, delta: number): void {
  const next = (g[item] ?? 0) + delta;
  if (next <= 0) delete g[item]; // keep the canonical form stable: never store a zero
  else g[item] = next;
}

export function applyEvent(world: World | null, e: Event): World {
  switch (e.type) {
    case 'GENESIS':
      return buildWorld(e.config);

    case 'MOVED': {
      const w = requireWorld(world, e.type);
      const a = agent(w, e.agentId);
      a.pos = { x: e.to.x, y: e.to.y };
      a.energy = e.energyAfter;
      return w;
    }

    case 'GATHERED': {
      const w = requireWorld(world, e.type);
      const a = agent(w, e.agentId);
      a.inventory[e.item] += e.qty;
      if (e.source === 'node') {
        nodeAt(w, e.tile.x, e.tile.y).stock -= e.qty;
      } else {
        addGround(w.ground[idx(w.size, e.tile.x, e.tile.y)]!, e.item, -e.qty);
      }
      return w;
    }

    case 'ATE': {
      const w = requireWorld(world, e.type);
      const a = agent(w, e.agentId);
      a.inventory[e.item] -= 1;
      a.satiation = e.satiationAfter;
      return w;
    }

    case 'DRANK': {
      const w = requireWorld(world, e.type);
      const a = agent(w, e.agentId);
      a.inventory[e.item] -= 1;
      a.hydration = e.hydrationAfter;
      return w;
    }

    case 'DROPPED': {
      const w = requireWorld(world, e.type);
      const a = agent(w, e.agentId);
      a.inventory[e.item] -= e.qty;
      addGround(w.ground[idx(w.size, e.tile.x, e.tile.y)]!, e.item, e.qty);
      return w;
    }

    case 'RESTED': {
      const w = requireWorld(world, e.type);
      agent(w, e.agentId).energy = e.energyAfter;
      return w;
    }

    case 'REGEN': {
      const w = requireWorld(world, e.type);
      nodeAt(w, e.tile.x, e.tile.y).stock += e.amount;
      return w;
    }

    case 'METABOLIZED': {
      const w = requireWorld(world, e.type);
      for (const d of e.deltas) {
        const a = agent(w, d.agentId);
        a.satiation = d.satiationAfter;
        a.hydration = d.hydrationAfter;
        a.health = d.healthAfter;
        a.starvingTicks = d.starvingTicksAfter;
        a.dehydratingTicks = d.dehydratingTicksAfter;
      }
      return w;
    }

    case 'AGENT_DIED': {
      const w = requireWorld(world, e.type);
      agent(w, e.agentId).alive = false;
      return w;
    }

    case 'ACTION_REJECTED':
      // A rejection changes no state — it is recorded so the agent (and the Mind Feed) can
      // see the rule bite. Still asserts the world exists.
      return requireWorld(world, e.type);

    case 'TICK_COMPLETED': {
      const w = requireWorld(world, e.type);
      w.tick = e.tick;
      w.rng = e.rng;
      return w;
    }

    default: {
      const _exhaustive: never = e;
      throw new Error(`unhandled event ${JSON.stringify(_exhaustive)}`);
    }
  }
}
