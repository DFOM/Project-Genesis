// PHASE-2 DONE TEST. Proves perception leaks nothing: no world state outside the agent's
// radius, no other agent's inventory or stats, no event-log access — and that witnessed memory
// records only acts observed within radius (observing an act is fine; reading private state is not).
import { describe, it, expect } from 'vitest';
import { perceive } from '../src/engine/index.js';
import { step } from '../src/referee/index.js';
import * as C from '../src/engine/config.js';
import { tinyWorld, addAgent, addNode, setGround, setTerrain, agentOf } from './helpers.js';

const R = C.PERCEPTION_RADIUS;

function build() {
  const w = tinyWorld(64);
  addAgent(w, 'agent-A', 30, 30);
  addAgent(w, 'agent-B', 33, 30); // in radius (dist 3) — A sees pos + distress only
  addAgent(w, 'agent-C', 55, 55); // out of radius
  addNode(w, 'grain', 31, 30, 5); // in radius
  addNode(w, 'grain', 55, 50, 5); // out of radius
  setGround(w, 32, 30, 'water', 2); // in radius
  setGround(w, 50, 50, 'grain', 4); // out of radius
  return w;
}

describe('perception leak — radius containment & structure', () => {
  it('exposes only in-radius tiles/agents; out-of-radius node & agent are absent', () => {
    const p = perceive(build(), 'agent-A');
    for (const t of p.tiles) {
      expect(Math.abs(t.x - 30)).toBeLessThanOrEqual(R);
      expect(Math.abs(t.y - 30)).toBeLessThanOrEqual(R);
    }
    expect(p.tiles.some((t) => t.x === 55 && t.y === 50)).toBe(false); // far node's tile
    expect(p.agents.map((a) => a.id)).not.toContain('agent-C');
  });

  it('carries no foreign private data and no event log', () => {
    const p = perceive(build(), 'agent-A');
    expect(Object.keys(p).sort()).toEqual(['agents', 'memory', 'self', 'tick', 'tiles']);
    for (const a of p.agents) expect(Object.keys(a).sort()).toEqual(['distress', 'id', 'pos']);
    // no global handles
    for (const forbidden of ['events', 'log', 'world', 'nodes', 'terrain', 'ground']) {
      expect(p).not.toHaveProperty(forbidden);
    }
  });
});

describe('perception leak — differential non-dependence', () => {
  it('is byte-identical when only out-of-view / private state changes; distress DOES propagate', () => {
    const w = build();
    const before = JSON.stringify(perceive(w, 'agent-A'));

    // Mutate ONLY things A must not see:
    w.nodes.find((n) => n.pos.x === 55 && n.pos.y === 50)!.stock = 1; // far node stock
    setTerrain(w, 55, 55, 'hill'); // far terrain
    setGround(w, 50, 50, 'grain', 9); // far ground
    agentOf(w, 'agent-C').pos = { x: 56, y: 56 }; // far agent moves (still far)
    // …and in-view agent B's PRIVATE stats (A only sees B's pos + distress):
    const b = agentOf(w, 'agent-B');
    b.inventory.grain = 99;
    b.energy = 1;
    b.health = 5;
    b.satiation = 100; // stays > 0 → distress unchanged
    b.hydration = 100;
    expect(JSON.stringify(perceive(w, 'agent-A'))).toBe(before);

    // Positive control: pushing B into distress DOES change A's view (distress is intentionally
    // visible) — so the test can't pass by perception ignoring everything.
    b.satiation = 0;
    expect(JSON.stringify(perceive(w, 'agent-A'))).not.toBe(before);
  });
});

describe('perception leak — witnessing respects the radius', () => {
  it('an out-of-radius act never enters memory; witnessing carries only observable fields', () => {
    const w = tinyWorld(40);
    addAgent(w, 'agent-01', 10, 10); // actor, standing on the node
    addNode(w, 'grain', 10, 10, 1); // exactly one unit → the gather empties it (lastUnit)
    addAgent(w, 'agent-00', 12, 10); // W1 within radius (dist 2)
    addAgent(w, 'agent-02', 39, 39); // W2 far outside radius

    const { world } = step(w, [{ agentId: 'agent-01', action: { type: 'GATHER' } }]);
    const near = agentOf(world, 'agent-00');
    const far = agentOf(world, 'agent-02');

    const wg = near.memory.find((m) => m.kind === 'witnessed_gathered');
    expect(wg).toBeDefined();
    if (wg && wg.kind === 'witnessed_gathered') {
      expect(wg.who).toBe('agent-01');
      expect(wg.lastUnit).toBe(true);
      // observable-only: no B private state on the entry
      for (const forbidden of ['inventory', 'satiation', 'hydration', 'energy', 'health']) {
        expect(wg).not.toHaveProperty(forbidden);
      }
    }
    expect(far.memory.some((m) => m.kind === 'witnessed_gathered')).toBe(false);
  });
});
