// A read-only projection of World for the renderer. Pure (engine stays a leaf). The renderer
// imports ONLY these types + receives Snapshot values over IPC — never World itself, never
// engine logic.
import { inDistress } from './perceive.js';
import type { World, Terrain } from './types.js';
import type { ItemType } from './contract.js';

export interface SnapshotNode {
  x: number;
  y: number;
  item: ItemType;
  stock: number;
}

export interface SnapshotAgent {
  id: string;
  x: number;
  y: number;
  alive: boolean;
  distress: boolean;
}

export interface Snapshot {
  tick: number;
  size: number;
  alive: number;
  dead: number;
  terrain: Terrain[]; // row-major, size*size
  nodes: SnapshotNode[];
  agents: SnapshotAgent[];
}

export function snapshot(world: World): Snapshot {
  return {
    tick: world.tick,
    size: world.size,
    alive: world.agents.filter((a) => a.alive).length,
    dead: world.agents.filter((a) => !a.alive).length,
    terrain: world.terrain,
    nodes: world.nodes.map((n) => ({ x: n.pos.x, y: n.pos.y, item: n.item, stock: n.stock })),
    agents: world.agents.map((a) => ({ id: a.id, x: a.pos.x, y: a.pos.y, alive: a.alive, distress: inDistress(a) })),
  };
}
