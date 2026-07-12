// Small hand-built worlds for unit tests (the full genesis map is 64×64 and awkward to
// assert against). Uses the real engine types so the referee/reducer run unchanged.
import { seedRng } from '../src/engine/index.js';
import type { Agent, Ground, ItemType, ResourceNode, Terrain, World } from '../src/engine/index.js';
import * as C from '../src/engine/config.js';

export function tinyWorld(size = 7, rngSeed = 1): World {
  const terrain: Terrain[] = new Array(size * size).fill('plain');
  const ground: Ground[] = Array.from({ length: size * size }, () => ({}));
  return { tick: 0, size, terrain, nodes: [], ground, agents: [], rng: seedRng(rngSeed) };
}

export function setTerrain(w: World, x: number, y: number, t: Terrain): void {
  w.terrain[y * w.size + x] = t;
}

export function addAgent(w: World, id: string, x: number, y: number, over: Partial<Agent> = {}): Agent {
  const a: Agent = {
    id,
    pos: { x, y },
    inventory: { ore: 0, water: 0, grain: 0 },
    satiation: C.SATIATION_MAX,
    hydration: C.HYDRATION_MAX,
    energy: C.ENERGY_MAX,
    health: C.HEALTH_MAX,
    alive: true,
    starvingTicks: 0,
    dehydratingTicks: 0,
    ...over,
  };
  w.agents.push(a);
  w.agents.sort((p, q) => (p.id < q.id ? -1 : p.id > q.id ? 1 : 0));
  return a;
}

export function addNode(w: World, item: ItemType, x: number, y: number, stock: number): ResourceNode {
  const n: ResourceNode = { pos: { x, y }, item, stock, max: C.NODE_MAX_STOCK, regen: 0 };
  w.nodes.push(n);
  w.nodes.sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
  return n;
}

export function setGround(w: World, x: number, y: number, item: ItemType, qty: number): void {
  w.ground[y * w.size + x] = { [item]: qty };
}

export function agentOf(w: World, id: string): Agent {
  const a = w.agents.find((x) => x.id === id);
  if (!a) throw new Error(`no agent ${id}`);
  return a;
}
