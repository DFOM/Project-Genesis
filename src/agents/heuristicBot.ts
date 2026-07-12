// Heuristic bot (Phase 1 — NO LLM). A pure, deterministic function of Perception, returning
// exactly ONE proposed action. It imports ONLY the engine contract — it cannot see World,
// the store, or the referee (enforced by lint + dependency-cruiser). This is the SAME `Mind`
// interface an LLM adapter implements in Phase 3.
//
// Agents START EMPTY (genesis gives an empty inventory) and there is NO lucky birthplace
// (uniform spawn). But grain (east) and water (south) are separate regions, so a memoryless
// agent that only ate where it stood would dehydrate on the walk to food. So the bot GATHERS
// A WORKING BUFFER of both while it is at a source and lives off inventory between regions —
// earned by working, not a starter pack. Whether that buffer is enough to survive is a
// property of the WORLD PHYSICS (config.ts): reach the seam and you live; born in the dead
// north/west and you never find both regions and die.
//
// Determinism without a mutable RNG: when the bot must "wander" (explore for resources), it
// derives a direction from a pure hash of (its id, the tick) — no Math.random, no writeback.
import type { Action, Dir, ItemType, Mind, Perception, PerceivedTile } from '../engine/contract.js';

const CONSUME_BELOW = 55; // eat/drink a held item when the need drops below this
const BUFFER = 12; // target units of EACH survival item to carry (earned, not granted)
const SEEK_BELOW = 90; // travel toward a survival item we're short of before the need gets critical
const ENERGY_STRANDED = 3; // rest rather than risk a 'too exhausted' MOVE with nowhere to refill
const ENERGY_LOW = 25; // top up energy when otherwise idle
const RUN_LENGTH = 24; // ticks to hold an exploration heading — run-and-tumble covers ground
// linearly (O(t)); a per-tick random walk only manages O(√t) and never crosses the map in time.

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

  // The two survival items, most-urgent (lowest need) first.
  const survival: Array<{ item: ItemType; level: number; consume: Action }> = [
    { item: 'water', level: self.hydration, consume: { type: 'DRINK', item: 'water' } },
    { item: 'grain', level: self.satiation, consume: { type: 'EAT', item: 'grain' } },
  ];
  survival.sort((a, b) => a.level - b.level);

  // 1) Consume the more-urgent need if it's low and we hold its item.
  for (const s of survival) {
    if (s.level < CONSUME_BELOW && inv[s.item] >= 1) return s.consume;
  }

  // 2) Standing on a survival resource we're still short of (< BUFFER) → gather (most urgent
  //    first; ore is never gathered — it's useless and would waste capacity).
  for (const s of survival) {
    if (inv[s.item] < BUFFER && totalHeld < self.capacity && tileHas(here, s.item)) return { type: 'GATHER' };
  }

  // 3) Rest before you're stranded (a MOVE at energy 0 is rejected 'too exhausted').
  if (self.energy <= ENERGY_STRANDED) return { type: 'REST' };

  // 4) Short of a survival item (buffer not full, and the need is trending down) → travel
  //    toward its nearest visible source. Urgent need first. Carrying a buffer of the OTHER
  //    item is what keeps the agent alive on the walk between the two regions.
  for (const s of survival) {
    if (inv[s.item] < BUFFER && s.level < SEEK_BELOW) {
      const target = nearestSource(p, self.pos, s.item);
      if (target) {
        const dir = stepToward(self.pos, target, tiles);
        if (dir) return { type: 'MOVE', dir };
      }
    }
  }

  // 5) Buffers full / needs comfortable → hold position near resources instead of drifting
  //    into a dead zone. Top up energy while idle.
  const bufferedBoth = inv.water >= BUFFER && inv.grain >= BUFFER;
  const comfortable = survival.every((s) => s.level >= SEEK_BELOW);
  if (bufferedBoth || comfortable || self.energy < ENERGY_LOW) return { type: 'REST' };

  // 6) Short of something with nothing in sight → EXPLORE. Hold a heading for RUN_LENGTH ticks
  //    (run-and-tumble) so the agent actually crosses the map to find the other region.
  const heading = hash(self.id, Math.floor(p.tick / RUN_LENGTH));
  const wanderDir = wander(self.pos, tiles, heading);
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

// Prefer the hashed heading; if it's blocked (water/edge) rotate deterministically to the
// next passable direction. Because `h` is stable across a run, the agent keeps a heading.
function wander(pos: { x: number; y: number }, tiles: Map<string, PerceivedTile>, h: number): Dir | null {
  const start = h % 4;
  for (let i = 0; i < 4; i++) {
    const d = DIRS[(start + i) % 4]!;
    const t = tiles.get(tkey(pos.x + DELTA[d].dx, pos.y + DELTA[d].dy));
    if (t !== undefined && t.passable) return d;
  }
  return null;
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
