// Heuristic bot (Phase 1 — NO LLM). A pure, deterministic function of Perception, returning
// exactly ONE proposed action. It imports ONLY the engine contract — it cannot see World,
// the store, or the referee (enforced by lint + dependency-cruiser). This is the SAME `Mind`
// interface an LLM adapter implements in Phase 3.
//
// Survival strategy for a MEMORYLESS agent with bounded vision: carry a RESERVE of BOTH
// needs. Grain (east) and water (south) are separated, so an agent that only eats where it
// stands will dehydrate on the way to food. Stocking a buffer of each near the seam lets it
// eat/drink from inventory and only re-gather when a buffer runs low. Bots that spawn far
// from the seam never find both and die — that is the intended selection pressure.
//
// Determinism without a mutable RNG: when the bot must "wander" (explore for resources), it
// derives a direction from a pure hash of (its id, the tick) — no Math.random, no writeback.
import type { Action, Dir, ItemType, Mind, Perception, PerceivedTile } from '../engine/contract.js';

const CONSUME_BELOW = 45; // eat/drink a held item when the need drops below this
const SEEK_BELOW = 70; // start travelling toward a resource before a need gets critical
const RESERVE = 6; // target buffer to carry of each survival item
const ENERGY_STRANDED = 3; // rest rather than risk a 'too exhausted' MOVE with nowhere to refill
const ENERGY_LOW = 20; // top up energy when otherwise idle

const DIRS: Dir[] = ['N', 'E', 'S', 'W'];
const DELTA: Record<Dir, { dx: number; dy: number }> = {
  N: { dx: 0, dy: -1 },
  S: { dx: 0, dy: 1 },
  E: { dx: 1, dy: 0 },
  W: { dx: -1, dy: 0 },
};

function tkey(x: number, y: number): string {
  return `${x},${y}`;
}

// FNV-1a hash over "id:tick" → a stable pseudo-random uint32 for tie-free wander choice.
function hash(id: string, tick: number): number {
  let h = 0x811c9dc5;
  const str = `${id}:${tick}`;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function tileHas(tile: PerceivedTile | undefined, item: ItemType): boolean {
  if (!tile) return false;
  if (tile.resource && tile.resource.item === item && tile.resource.stock > 0) return true;
  if (tile.ground && (tile.ground[item] ?? 0) > 0) return true;
  return false;
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

function decide(p: Perception): Action {
  const { self } = p;
  const inv = self.inventory;
  const totalHeld = inv.ore + inv.water + inv.grain;
  const tiles = new Map<string, PerceivedTile>();
  for (const t of p.tiles) tiles.set(tkey(t.x, t.y), t);
  const here = tiles.get(tkey(self.pos.x, self.pos.y));

  // The two survival items, most-urgent (lowest reserve of need) first.
  const survival: Array<{ item: ItemType; level: number; consume: Action }> = [
    { item: 'water', level: self.hydration, consume: { type: 'DRINK', item: 'water' } },
    { item: 'grain', level: self.satiation, consume: { type: 'EAT', item: 'grain' } },
  ];
  survival.sort((a, b) => a.level - b.level);

  // 1) Consume the more-urgent need if it's low and we're carrying its item.
  for (const s of survival) {
    if (s.level < CONSUME_BELOW && inv[s.item] >= 1) return s.consume;
  }

  // 2) Standing on a survival resource we're short of (below RESERVE), with room → gather.
  for (const s of survival) {
    if (inv[s.item] < RESERVE && totalHeld < self.capacity && tileHas(here, s.item)) return { type: 'GATHER' };
  }

  // 3) Rest before you're stranded (a MOVE at energy 0 is rejected 'too exhausted').
  if (self.energy <= ENERGY_STRANDED) return { type: 'REST' };

  // 4) Travel toward the nearest visible source of a survival item we're short of. Prefer
  //    the more-urgent need; a low current level widens the search (SEEK_BELOW).
  for (const s of survival) {
    const short = inv[s.item] < RESERVE;
    const worried = s.level < SEEK_BELOW;
    if (!short && !worried) continue;
    const target = nearestSource(p, self.pos, s.item);
    if (target) {
      const dir = stepToward(self.pos, target, tiles);
      if (dir) return { type: 'MOVE', dir };
    }
  }

  // 5) Comfortable (needs fine, buffers stocked) → rest in place near resources rather than
  //    wander off and drift into a dead zone. Top up energy while we're at it.
  const comfortable = survival.every((s) => s.level >= SEEK_BELOW && inv[s.item] >= RESERVE);
  if (comfortable || self.energy < ENERGY_LOW) return { type: 'REST' };

  // 6) Short of something but nothing in sight → explore in a hashed (deterministic) direction.
  const wanderDir = wander(self.pos, tiles, hash(self.id, p.tick));
  return wanderDir ? { type: 'MOVE', dir: wanderDir } : { type: 'REST' };
}

function nearestSource(p: Perception, pos: { x: number; y: number }, item: ItemType): PerceivedTile | undefined {
  let best: PerceivedTile | undefined;
  let bestD = Infinity;
  for (const t of p.tiles) {
    if (!tileHas(t, item)) continue;
    const d = manhattan(pos.x, pos.y, t.x, t.y);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

function stepToward(pos: { x: number; y: number }, target: PerceivedTile, tiles: Map<string, PerceivedTile>): Dir | null {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  const horiz: Dir = dx > 0 ? 'E' : 'W';
  const vert: Dir = dy > 0 ? 'S' : 'N';
  const priority: Dir[] = Math.abs(dx) >= Math.abs(dy) ? [horiz, vert] : [vert, horiz];
  for (const d of priority) {
    if ((d === 'E' || d === 'W') && dx === 0) continue;
    if ((d === 'N' || d === 'S') && dy === 0) continue;
    const nb = { x: pos.x + DELTA[d].dx, y: pos.y + DELTA[d].dy };
    const t = tiles.get(tkey(nb.x, nb.y));
    if (t && t.passable) return d;
  }
  return null;
}

function wander(pos: { x: number; y: number }, tiles: Map<string, PerceivedTile>, h: number): Dir | null {
  const passableDirs = DIRS.filter((d) => {
    const t = tiles.get(tkey(pos.x + DELTA[d].dx, pos.y + DELTA[d].dy));
    return t !== undefined && t.passable;
  });
  if (passableDirs.length === 0) return null;
  return passableDirs[h % passableDirs.length]!;
}

// A Mind bound to an agent id. propose() is synchronous here; the interface allows a Promise
// so an LLM adapter can drop in unchanged in Phase 3.
export function heuristicBot(id: string): Mind {
  return {
    id,
    propose(p: Perception): Action[] {
      return [decide(p)];
    },
  };
}
