// Heuristic bot (Phase 1 — NO LLM). A pure, deterministic function of Perception, returning
// exactly ONE proposed action. It imports ONLY the engine contract — it cannot see World,
// the store, or the referee (enforced by lint + dependency-cruiser). This is the SAME `Mind`
// interface an LLM adapter implements in Phase 3.
//
// Determinism without a mutable RNG: when the bot must "wander", it derives a direction from
// a pure hash of (its id, the tick) — no Math.random, no writeback — so a run is fully
// reproducible from the seed. Policy (DESIGN §11 "eat when hungry, gather when idle, wander
// otherwise"), extended for the two-need shuttle and energy cost:
import type { Action, Dir, ItemType, Mind, Perception, PerceivedTile } from '../engine/contract.js';

const NEED_LOW = 45; // consume a held item when a need drops below this
const SEEK_LEVEL = 65; // start travelling toward a resource before a need gets critical
const ENERGY_STRANDED = 3; // rest rather than risk a 'too exhausted' MOVE with nowhere to refill
const ENERGY_LOW = 18; // top up energy when idle-ish

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

  // 1) Consume the more-urgent need if we're carrying the item for it.
  const byUrgency: Array<{ item: ItemType; level: number; act: Action }> = [
    { item: 'water', level: self.hydration, act: { type: 'DRINK', item: 'water' } },
    { item: 'grain', level: self.satiation, act: { type: 'EAT', item: 'grain' } },
  ].sort((a, b) => a.level - b.level);
  for (const n of byUrgency) {
    if (n.level < NEED_LOW && inv[n.item] >= 1) return n.act;
  }

  // 2) Standing on a useful resource with room → gather (stock up for the shuttle). Never
  //    gather ore: it is useless and would waste capacity.
  const here = tiles.get(tkey(self.pos.x, self.pos.y));
  if (totalHeld < self.capacity && (tileHas(here, 'water') || tileHas(here, 'grain'))) {
    return { type: 'GATHER' };
  }

  // 3) Rest before you're stranded (a MOVE at energy 0 is rejected 'too exhausted').
  if (self.energy <= ENERGY_STRANDED) return { type: 'REST' };

  // 4) Travel toward the nearest visible source of the more-urgent need we don't hold.
  const seeks: ItemType[] = [];
  const waterUrgent = self.hydration < SEEK_LEVEL && inv.water < 1;
  const foodUrgent = self.satiation < SEEK_LEVEL && inv.grain < 1;
  if (waterUrgent && foodUrgent) seeks.push(self.hydration <= self.satiation ? 'water' : 'grain', self.hydration <= self.satiation ? 'grain' : 'water');
  else if (waterUrgent) seeks.push('water');
  else if (foodUrgent) seeks.push('grain');
  for (const item of seeks) {
    let best: PerceivedTile | undefined;
    let bestD = Infinity;
    for (const t of p.tiles) {
      if (!tileHas(t, item)) continue;
      const d = manhattan(self.pos.x, self.pos.y, t.x, t.y);
      if (d < bestD) {
        bestD = d;
        best = t;
      }
    }
    if (best) {
      const dir = stepToward(self.pos, best, tiles);
      if (dir) return { type: 'MOVE', dir };
    }
  }

  // 5) Idle-ish and low energy → rest.
  if (self.energy < ENERGY_LOW) return { type: 'REST' };

  // 6) Wander in a hashed (deterministic) passable direction.
  const wanderDir = wander(self.pos, tiles, hash(self.id, p.tick));
  if (wanderDir) return { type: 'MOVE', dir: wanderDir };
  return { type: 'REST' }; // boxed in — resting is the only safe move
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
