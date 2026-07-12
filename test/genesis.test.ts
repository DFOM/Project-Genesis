// The genesis reachability invariant (plan fix #1): every resource node sits on a passable
// tile, and every node is reachable from every agent spawn. Without this, a water node on an
// impassable tile is unobtainable and every agent dehydrates.
import { describe, it, expect } from 'vitest';
import { buildWorld } from '../src/engine/index.js';
import type { Terrain, Vec, World } from '../src/engine/index.js';
import { makeConfig } from '../src/orchestrator/harness.js';

function passable(t: Terrain): boolean {
  return t !== 'water';
}

function reachable(w: World, start: Vec): Set<number> {
  const seen = new Set<number>();
  const s = start.y * w.size + start.x;
  if (!passable(w.terrain[s]!)) return seen;
  const q = [s];
  seen.add(s);
  while (q.length) {
    const cur = q.pop()!;
    const cx = cur % w.size;
    const cy = Math.floor(cur / w.size);
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      const nx = cx + dx!;
      const ny = cy + dy!;
      if (nx < 0 || ny < 0 || nx >= w.size || ny >= w.size) continue;
      const ni = ny * w.size + nx;
      if (seen.has(ni) || !passable(w.terrain[ni]!)) continue;
      seen.add(ni);
      q.push(ni);
    }
  }
  return seen;
}

describe('genesis invariants', () => {
  for (const seed of [1, 42, 100, 777, 2024]) {
    it(`seed ${seed}: nodes are passable and reachable from every spawn; map is uneven`, () => {
      const w = buildWorld(makeConfig(seed));

      // (a) every node on a passable tile
      for (const n of w.nodes) expect(passable(w.terrain[n.pos.y * w.size + n.pos.x]!)).toBe(true);

      // (b) every node reachable from every spawn (single connected component covers both)
      for (const a of w.agents) {
        const comp = reachable(w, a.pos);
        expect(comp.has(a.pos.y * w.size + a.pos.x)).toBe(true);
        for (const n of w.nodes) expect(comp.has(n.pos.y * w.size + n.pos.x)).toBe(true);
      }

      // all three resources exist, and grain (east) vs water (south) are separated
      const items = new Set(w.nodes.map((n) => n.item));
      expect(items.has('ore')).toBe(true);
      expect(items.has('grain')).toBe(true);
      expect(items.has('water')).toBe(true);
      const grainYs = w.nodes.filter((n) => n.item === 'grain').map((n) => n.pos.y);
      const waterYs = w.nodes.filter((n) => n.item === 'water').map((n) => n.pos.y);
      // grain lives north of the southern water band → genuinely different regions
      expect(Math.max(...grainYs)).toBeLessThan(Math.min(...waterYs));
    });
  }
});
