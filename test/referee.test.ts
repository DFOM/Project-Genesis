import { describe, it, expect } from 'vitest';
import { step, decide } from '../src/referee/index.js';
import type { Event, ProposedAction, World } from '../src/engine/index.js';
import * as C from '../src/engine/config.js';
import { tinyWorld, addAgent, addNode, setTerrain, setGround, agentOf } from './helpers.js';

function rejectionReason(events: Event[], agentId: string): string | undefined {
  const r = events.find((e) => e.type === 'ACTION_REJECTED' && e.agentId === agentId);
  return r && r.type === 'ACTION_REJECTED' ? r.reason : undefined;
}

function only(world: World, agentId: string, action: ProposedAction['action']): Event[] {
  return decide(world, [{ agentId, action }]);
}

describe('referee — MOVE', () => {
  it('moves onto passable terrain and deducts energy', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3, { energy: 10 });
    const { world, events } = step(w, [{ agentId: 'agent-00', action: { type: 'MOVE', dir: 'E' } }]);
    expect(events.some((e) => e.type === 'MOVED')).toBe(true);
    expect(agentOf(world, 'agent-00').pos).toEqual({ x: 4, y: 3 });
    expect(agentOf(world, 'agent-00').energy).toBe(10 - C.MOVE_ENERGY_COST);
  });

  it('rejects out of bounds', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 0, 0);
    expect(rejectionReason(only(w, 'agent-00', { type: 'MOVE', dir: 'W' }), 'agent-00')).toBe('out of bounds');
  });

  it('rejects blocked terrain (water)', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3);
    setTerrain(w, 4, 3, 'water');
    expect(rejectionReason(only(w, 'agent-00', { type: 'MOVE', dir: 'E' }), 'agent-00')).toBe('blocked terrain (water)');
  });

  it('rejects when too exhausted (energy 0)', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3, { energy: 0 });
    expect(rejectionReason(only(w, 'agent-00', { type: 'MOVE', dir: 'E' }), 'agent-00')).toBe('too exhausted');
  });
});

describe('referee — GATHER', () => {
  it('gathers from a node and decrements stock', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3);
    addNode(w, 'grain', 3, 3, 5);
    const { world, events } = step(w, [{ agentId: 'agent-00', action: { type: 'GATHER' } }]);
    const g = events.find((e) => e.type === 'GATHERED');
    expect(g && g.type === 'GATHERED' && g.source).toBe('node');
    expect(agentOf(world, 'agent-00').inventory.grain).toBe(C.GATHER_QTY);
    expect(world.nodes[0]!.stock).toBe(5 - C.GATHER_QTY);
  });

  it('gathers from the ground when there is no node', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3);
    setGround(w, 3, 3, 'water', 3);
    const events = only(w, 'agent-00', { type: 'GATHER' });
    const g = events.find((e) => e.type === 'GATHERED');
    expect(g && g.type === 'GATHERED' && g.source).toBe('ground');
  });

  it('rejects when nothing to gather', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3);
    expect(rejectionReason(only(w, 'agent-00', { type: 'GATHER' }), 'agent-00')).toBe('nothing to gather here');
  });

  it('rejects when inventory is full', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3, { inventory: { ore: C.INVENTORY_CAPACITY, water: 0, grain: 0 } });
    addNode(w, 'grain', 3, 3, 5);
    expect(rejectionReason(only(w, 'agent-00', { type: 'GATHER' }), 'agent-00')).toBe('inventory full');
  });
});

describe('referee — EAT / DRINK', () => {
  it('eats grain and raises satiation', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3, { satiation: 10, inventory: { ore: 0, water: 0, grain: 2 } });
    const { world, events } = step(w, [{ agentId: 'agent-00', action: { type: 'EAT', item: 'grain' } }]);
    expect(events.some((e) => e.type === 'ATE')).toBe(true);
    // +EAT_GAIN then -SATIATION_DECAY from the same-tick metabolism
    expect(agentOf(world, 'agent-00').satiation).toBe(10 + C.EAT_GAIN - C.SATIATION_DECAY);
    expect(agentOf(world, 'agent-00').inventory.grain).toBe(1);
  });

  it('rejects eating non-food', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3, { inventory: { ore: 5, water: 0, grain: 0 } });
    expect(rejectionReason(only(w, 'agent-00', { type: 'EAT', item: 'ore' }), 'agent-00')).toBe('only grain is edible');
  });

  it('rejects eating grain not held', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3);
    expect(rejectionReason(only(w, 'agent-00', { type: 'EAT', item: 'grain' }), 'agent-00')).toBe('item not in inventory');
  });

  it('drinks water and raises hydration', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3, { hydration: 10, inventory: { ore: 0, water: 2, grain: 0 } });
    const events = only(w, 'agent-00', { type: 'DRINK', item: 'water' });
    expect(events.some((e) => e.type === 'DRANK')).toBe(true);
  });

  it('rejects drinking non-water', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3, { inventory: { ore: 0, water: 0, grain: 3 } });
    expect(rejectionReason(only(w, 'agent-00', { type: 'DRINK', item: 'grain' }), 'agent-00')).toBe('only water is drinkable');
  });
});

describe('referee — DROP / REST', () => {
  it('drops onto the ground (not destroyed) and can be re-gathered', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3, { inventory: { ore: 4, water: 0, grain: 0 } });
    const { world } = step(w, [{ agentId: 'agent-00', action: { type: 'DROP', item: 'ore', qty: 3 } }]);
    expect(world.ground[3 * world.size + 3]!.ore).toBe(3);
    expect(agentOf(world, 'agent-00').inventory.ore).toBe(1);
  });

  it('rejects dropping more than held', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3, { inventory: { ore: 1, water: 0, grain: 0 } });
    expect(rejectionReason(only(w, 'agent-00', { type: 'DROP', item: 'ore', qty: 5 }), 'agent-00')).toBe('qty exceeds held');
  });

  it('rest restores energy', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3, { energy: 10 });
    const events = only(w, 'agent-00', { type: 'REST' });
    expect(events.some((e) => e.type === 'RESTED')).toBe(true);
  });
});

describe('referee — one action per tick', () => {
  it('rejects a second action from the same agent', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3);
    const events = decide(w, [
      { agentId: 'agent-00', action: { type: 'REST' } },
      { agentId: 'agent-00', action: { type: 'REST' } },
    ]);
    expect(rejectionReason(events, 'agent-00')).toBe('one action per tick');
  });
});

describe('referee — contested resolution (seeded shuffle, not id order)', () => {
  it('only one agent gets the last unit; the other is rejected', () => {
    const w = tinyWorld();
    addAgent(w, 'agent-00', 3, 3);
    addAgent(w, 'agent-01', 3, 3);
    addNode(w, 'grain', 3, 3, 1); // a single unit — contested
    const events = decide(w, [
      { agentId: 'agent-00', action: { type: 'GATHER' } },
      { agentId: 'agent-01', action: { type: 'GATHER' } },
    ]);
    const gathered = events.filter((e) => e.type === 'GATHERED');
    const rejected = events.filter((e) => e.type === 'ACTION_REJECTED');
    expect(gathered).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.type === 'ACTION_REJECTED' && rejected[0]!.reason).toBe('nothing to gather here');
  });

  it('the winner is decided by the rng, not always the alphabetically-first id', () => {
    const winners = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      const w = tinyWorld(7, seed);
      addAgent(w, 'agent-00', 3, 3);
      addAgent(w, 'agent-01', 3, 3);
      addNode(w, 'grain', 3, 3, 1);
      const events = decide(w, [
        { agentId: 'agent-00', action: { type: 'GATHER' } },
        { agentId: 'agent-01', action: { type: 'GATHER' } },
      ]);
      const g = events.find((e) => e.type === 'GATHERED');
      if (g && g.type === 'GATHERED') winners.add(g.agentId);
    }
    // Across seeds, BOTH agents win sometimes → order is not a permanent id-order advantage.
    expect(winners).toEqual(new Set(['agent-00', 'agent-01']));
  });
});

describe('referee — metabolism, gradual death via health', () => {
  it('a need at 0 drains health; death fires only at health 0, cause starvation', () => {
    const w = tinyWorld();
    // satiation about to hit 0; hydration comfortable → starvation, not dehydration.
    addAgent(w, 'agent-00', 3, 3, { satiation: 1, hydration: 100, health: C.HEALTH_MAX });
    let world = w;
    let diedAt = -1;
    const maxTicks = C.HEALTH_MAX / C.HEALTH_DRAIN + 10;
    for (let t = 0; t < maxTicks; t++) {
      const res = step(world, []); // no proposals — only metabolism runs
      world = res.world;
      const died = res.events.find((e) => e.type === 'AGENT_DIED');
      if (died && died.type === 'AGENT_DIED') {
        expect(died.cause).toBe('starvation');
        diedAt = t;
        break;
      }
    }
    expect(diedAt).toBeGreaterThan(0);
    expect(agentOf(world, 'agent-00').alive).toBe(false);
  });
});
