// Deterministic world construction from a seed. Pure: the only entropy is world.rng.
//
// The map is deliberately non-uniform (DESIGN §3): ore north, grain in the eastern middle
// band, water south. Grain (food) and water (drink) are SEPARATED so no tile is
// self-sufficient — but they share a seam near y=GRAIN_BAND_MAX_Y where a radius-bounded,
// memoryless bot can survive by shuttling. Agents far from the seam die (intended).
//
// REACHABILITY INVARIANT: MOVE rejects 'water' terrain and GATHER only pulls from the
// agent's own tile, so a node on an impassable tile is unobtainable. Genesis therefore
// guarantees (and test/genesis.test.ts asserts) that every node sits on a passable tile and
// every node is reachable from every spawn. Placement retries deterministically up to
// MAX_GENESIS_ATTEMPTS, then THROWS — an unbounded retry would be an invisible infinite hang.
import * as C from './config.js';
import { idx } from './types.js';
import type { Agent, Ground, ResourceNode, Terrain, Vec, World, RunConfig } from './types.js';
import type { ItemType } from './contract.js';
import { nextRng, randInt, seedRng, type RngState } from './rng.js';

interface Scratch {
  rng: RngState;
}

function draw(s: Scratch, n: number): number {
  const r = randInt(s.rng, n);
  s.rng = r.state;
  return r.value;
}

function terrainAt(x: number, y: number): Terrain {
  if (y < C.ORE_BAND_MAX_Y) return 'hill';
  if (y < C.GRAIN_BAND_MAX_Y && x >= C.GRAIN_MIN_X) return 'field';
  return 'plain';
}

function passable(t: Terrain): boolean {
  return t !== 'water';
}

// Zero-padded numeric id so canonical sort-by-id === spawn order (agent-00 … agent-29).
function agentId(i: number): string {
  return `agent-${String(i).padStart(2, '0')}`;
}

function emptyInventory(): Record<ItemType, number> {
  return { ore: 0, water: 0, grain: 0 };
}

// BFS over passable tiles from a start; returns the set of reachable tile indices.
function reachableFrom(size: number, terrain: Terrain[], start: Vec): Set<number> {
  const seen = new Set<number>();
  const startI = idx(size, start.x, start.y);
  if (!passable(terrain[startI]!)) return seen;
  const queue: number[] = [startI];
  seen.add(startI);
  const dirs = [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    const cx = cur % size;
    const cy = Math.floor(cur / size);
    for (const [dx, dy] of dirs) {
      const nx = cx + dx!;
      const ny = cy + dy!;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const ni = idx(size, nx, ny);
      if (seen.has(ni)) continue;
      if (!passable(terrain[ni]!)) continue;
      seen.add(ni);
      queue.push(ni);
    }
  }
  return seen;
}

// One placement attempt. Returns a candidate world or null if the reachability invariant
// fails (so the caller can retry with the advanced rng state).
function attempt(config: RunConfig, rngIn: RngState): { world: World | null; rng: RngState } {
  const size = C.WORLD_SIZE;
  const s: Scratch = { rng: rngIn };

  // 1. Base terrain from the bands.
  const terrain: Terrain[] = new Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      terrain[idx(size, x, y)] = terrainAt(x, y);
    }
  }

  // 2. Water sources: a FEW clustered lakes in the south. Convergence on these few sources
  //    (rather than many scattered ones) is what forces agents to compete.
  // Water sources sit just SOUTH of the grain↔water seam, spread DETERMINISTICALLY and evenly
  // across x. Fixed placement makes the world structure identical across seeds (only spawns and
  // staggered starts vary), so mortality is robust; the seam concentration forces convergence.
  const waterCenters: Vec[] = [];
  for (let p = 0; p < C.WATER_PATCHES; p++) {
    const cx = Math.max(0, Math.min(size - 1, Math.floor(((p + 0.5) / C.WATER_PATCHES) * size)));
    const cy = Math.min(size - 1, C.GRAIN_BAND_MAX_Y + 2); // seam's south side
    waterCenters.push({ x: cx, y: cy });
    for (let dy = -C.LAKE_HALF; dy <= C.LAKE_HALF; dy++) {
      for (let dx = -C.LAKE_HALF; dx <= C.LAKE_HALF; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= C.GRAIN_BAND_MAX_Y && x < size && y < size) terrain[idx(size, x, y)] = 'water';
      }
    }
  }
  const isShore = (x: number, y: number): boolean => {
    if (!passable(terrain[idx(size, x, y)]!)) return false;
    return (
      (x > 0 && terrain[idx(size, x - 1, y)] === 'water') ||
      (x < size - 1 && terrain[idx(size, x + 1, y)] === 'water') ||
      (y > 0 && terrain[idx(size, x, y - 1)] === 'water') ||
      (y < size - 1 && terrain[idx(size, x, y + 1)] === 'water')
    );
  };
  const shore: Vec[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (isShore(x, y)) shore.push({ x, y });
  if (shore.length < C.WATER_PATCHES * C.NODES_PER_PATCH) return { world: null, rng: s.rng };

  // 3. Resource nodes (rich, clustered). At most one node per tile.
  const nodes: ResourceNode[] = [];
  const usedTile = new Set<number>();
  const manh = (a: Vec, b: Vec): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const place = (item: ItemType, pos: Vec): boolean => {
    const i = idx(size, pos.x, pos.y);
    if (usedTile.has(i)) return false;
    usedTile.add(i);
    nodes.push({ pos, item, stock: C.NODE_START_STOCK, max: C.NODE_MAX_STOCK, regen: C.NODE_REGEN_PER_TICK });
    return true;
  };

  // Water nodes: the nearest unused shore tiles to each lake centre (deterministic — no rng).
  for (const center of waterCenters) {
    const ranked = shore
      .filter((t) => !usedTile.has(idx(size, t.x, t.y)))
      .sort((a, b) => manh(a, center) - manh(b, center) || a.y - b.y || a.x - b.x);
    for (let k = 0; k < C.NODES_PER_PATCH && k < ranked.length; k++) place('water', ranked[k]!);
  }

  // Grain patches sit just NORTH of the seam, spread DETERMINISTICALLY across the eastern x —
  // facing the water patches across the seam, so the shuttle is always short. Nodes fill fixed
  // offsets around the patch centre (a tight cluster) on field tiles.
  const grainOffsets: Vec[] = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: -1, y: -1 },
  ];
  for (let p = 0; p < C.GRAIN_PATCHES; p++) {
    const spanX = size - C.GRAIN_MIN_X;
    const cx = Math.max(C.GRAIN_MIN_X, Math.min(size - 1, C.GRAIN_MIN_X + Math.floor(((p + 0.5) / C.GRAIN_PATCHES) * spanX)));
    const cy = Math.max(C.ORE_BAND_MAX_Y, C.GRAIN_BAND_MAX_Y - 2); // seam's north side
    let placed = 0;
    for (const o of grainOffsets) {
      if (placed >= C.NODES_PER_PATCH) break;
      const x = cx + o.x;
      const y = cy + o.y;
      if (x >= 0 && y >= 0 && x < size && y < size && terrain[idx(size, x, y)] === 'field' && place('grain', { x, y })) placed++;
    }
  }

  // Ore: scattered on passable hill tiles in the north. Inert — the money candidate.
  for (let k = 0; k < C.ORE_NODES; k++) {
    const x = draw(s, size);
    const y = Math.min(draw(s, C.ORE_BAND_MAX_Y), draw(s, C.ORE_BAND_MAX_Y));
    if (passable(terrain[idx(size, x, y)]!)) place('ore', { x, y });
  }

  // 4. Spawn agents on random passable tiles.
  const agents: Agent[] = [];
  const spawnTiles: Vec[] = [];
  for (let i = 0; i < config.agentCount; i++) {
    let pos: Vec;
    let guard = 0;
    do {
      // Uniform over passable tiles — no birthplace luck. Survivability must come from the
      // physics, not from being born on the seam. Agents in the dead north/west perish.
      pos = { x: draw(s, size), y: draw(s, size) };
      guard++;
    } while (!passable(terrain[idx(size, pos.x, pos.y)]!) && guard < 1000);
    spawnTiles.push(pos);
    agents.push({
      id: agentId(i),
      pos,
      inventory: emptyInventory(),
      // Staggered starts (desynchronise the first feeding crisis).
      satiation: C.SATIATION_START_MIN + draw(s, C.SATIATION_START - C.SATIATION_START_MIN + 1),
      hydration: C.HYDRATION_START_MIN + draw(s, C.HYDRATION_START - C.HYDRATION_START_MIN + 1),
      energy: C.ENERGY_START,
      health: C.HEALTH_START,
      alive: true,
      starvingTicks: 0,
      dehydratingTicks: 0,
      memory: [],
      lastVisible: [],
    });
  }

  // 5. Reachability invariant: every node reachable from every spawn. Because the passable
  // graph is connected iff one flood-fill covers all node tiles from one spawn AND every
  // spawn lands in that same component, it suffices to check that the component containing
  // the first spawn contains all spawns and all nodes.
  const comp = reachableFrom(size, terrain, spawnTiles[0]!);
  for (const sp of spawnTiles) if (!comp.has(idx(size, sp.x, sp.y))) return { world: null, rng: s.rng };
  for (const n of nodes) if (!comp.has(idx(size, n.pos.x, n.pos.y))) return { world: null, rng: s.rng };
  // Need at least some of each resource to be reachable, or survival is impossible.
  const kinds = new Set(nodes.map((n) => n.item));
  if (!kinds.has('grain') || !kinds.has('water') || !kinds.has('ore')) return { world: null, rng: s.rng };

  // 6. Canonical ordering. terrain/ground are index-addressed; nodes sorted by (y,x);
  // agents already in id order by construction.
  nodes.sort((a, b) => a.pos.y - b.pos.y || a.pos.x - b.pos.x);
  const ground: Ground[] = new Array(size * size);
  for (let i = 0; i < ground.length; i++) ground[i] = {};

  const world: World = {
    tick: 0,
    size,
    terrain,
    nodes,
    ground,
    agents,
    rng: s.rng,
  };
  return { world, rng: s.rng };
}

// Build the initial world deterministically, retrying placement (bounded) until the
// reachability invariant holds. Called by the GENESIS case of applyEvent.
export function buildWorld(config: RunConfig): World {
  let rng = seedRng(config.seed);
  for (let a = 0; a < C.MAX_GENESIS_ATTEMPTS; a++) {
    const res = attempt(config, rng);
    if (res.world) return res.world;
    // Advance rng deterministically before the next attempt so retries actually differ.
    rng = nextRng(res.rng).state;
  }
  throw new Error(
    `genesis: could not place a reachable map after ${C.MAX_GENESIS_ATTEMPTS} attempts (seed ${config.seed}). ` +
      `Check patch counts / lake size / band sizes in engine/config.ts.`,
  );
}
