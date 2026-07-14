// perceive(world, agentId) → the bounded Perception for ONE agent. This is the entire
// universe from inside an agent's head. It exposes ONLY: the agent's own tile + a
// PERCEPTION_RADIUS square, the agent's own inventory/stats/capacity, and nearby agents'
// positions plus a `distress` flag. It NEVER exposes global state, another agent's
// inventory or stats, or the event log (CLAUDE.md invariant #4).
//
// CLAUDE.md invariant #8: everything the referee can reject on is exposed here, so a bot
// (and, in Phase 3, an LLM) can foresee and avoid rejections — e.g. `capacity` for
// 'inventory full', `passable` for 'blocked terrain', `energy` for 'too exhausted'.
import * as C from './config.js';
import { idx } from './types.js';
import type { World, Agent, Terrain } from './types.js';
import type { Perception, PerceivedTile, PerceivedAgent } from './contract.js';

function totalHeld(a: Agent): number {
  return a.inventory.ore + a.inventory.water + a.inventory.grain;
}

// An agent is in distress (visible to others) when a need is exhausted and health is draining.
export function inDistress(a: Agent): boolean {
  return a.alive && (a.satiation === 0 || a.hydration === 0);
}

function passable(t: Terrain): boolean {
  return t !== 'water';
}

export function perceive(world: World, agentId: string): Perception {
  const self = world.agents.find((a) => a.id === agentId);
  if (!self) throw new Error(`perceive: unknown agent ${agentId}`);

  // Index nodes by tile once (O(nodes)) so the radius scan is O(1) per tile, not O(nodes).
  const nodeByTile = new Map<number, (typeof world.nodes)[number]>();
  for (const n of world.nodes) nodeByTile.set(idx(world.size, n.pos.x, n.pos.y), n);

  const r = C.PERCEPTION_RADIUS;
  const tiles: PerceivedTile[] = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const x = self.pos.x + dx;
      const y = self.pos.y + dy;
      if (x < 0 || y < 0 || x >= world.size || y >= world.size) continue; // off-map → absent
      const i = idx(world.size, x, y);
      const terrain = world.terrain[i]!;
      const node = nodeByTile.get(i);
      const groundStack = world.ground[i]!;
      const hasGround = Object.keys(groundStack).length > 0;
      const tile: PerceivedTile = { x, y, terrain, passable: passable(terrain) };
      if (node) tile.resource = { item: node.item, stock: node.stock };
      if (hasGround) tile.ground = { ...groundStack };
      tiles.push(tile);
    }
  }

  const agents: PerceivedAgent[] = [];
  for (const other of world.agents) {
    if (other.id === agentId || !other.alive) continue;
    if (Math.abs(other.pos.x - self.pos.x) > r || Math.abs(other.pos.y - self.pos.y) > r) continue;
    agents.push({ id: other.id, pos: { x: other.pos.x, y: other.pos.y }, distress: inDistress(other) });
  }

  return {
    tick: world.tick,
    self: {
      id: self.id,
      pos: { x: self.pos.x, y: self.pos.y },
      inventory: { ...self.inventory },
      capacity: C.INVENTORY_CAPACITY,
      satiation: self.satiation,
      hydration: self.hydration,
      energy: self.energy,
      health: self.health,
    },
    tiles,
    agents,
    memory: self.memory.map((m) => ({ ...m })), // defensive copy — callers can't mutate world state
  };
}

export { totalHeld };
