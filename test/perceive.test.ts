// Perception is bounded (CLAUDE.md invariant #4) and exposes everything the referee rejects
// on (invariant #8). This anticipates the Phase-2 done test but guards the contract now.
import { describe, it, expect } from 'vitest';
import { perceive } from '../src/engine/index.js';
import * as C from '../src/engine/config.js';
import { tinyWorld, addAgent, addNode, setGround } from './helpers.js';

describe('perceive — bounded view', () => {
  it('exposes only tiles within PERCEPTION_RADIUS', () => {
    const w = tinyWorld(64);
    addAgent(w, 'agent-00', 32, 32);
    const p = perceive(w, 'agent-00');
    for (const t of p.tiles) {
      expect(Math.abs(t.x - 32)).toBeLessThanOrEqual(C.PERCEPTION_RADIUS);
      expect(Math.abs(t.y - 32)).toBeLessThanOrEqual(C.PERCEPTION_RADIUS);
    }
  });

  it('does not expose distant agents, and never their inventory/stats', () => {
    const w = tinyWorld(64);
    addAgent(w, 'agent-00', 10, 10);
    addAgent(w, 'agent-01', 11, 10); // near
    addAgent(w, 'agent-02', 60, 60); // far
    const p = perceive(w, 'agent-00');
    const ids = p.agents.map((a) => a.id);
    expect(ids).toContain('agent-01');
    expect(ids).not.toContain('agent-02');
    // The PerceivedAgent shape carries only id/pos/distress — no inventory field exists.
    expect(Object.keys(p.agents[0]!).sort()).toEqual(['distress', 'id', 'pos']);
  });

  it('exposes rejection preconditions: capacity, passability, energy, resources, ground', () => {
    const w = tinyWorld(64);
    addAgent(w, 'agent-00', 20, 20, { energy: 7 });
    addNode(w, 'grain', 21, 20, 4);
    setGround(w, 20, 20, 'water', 2);
    const p = perceive(w, 'agent-00');
    expect(p.self.capacity).toBe(C.INVENTORY_CAPACITY); // → foresee 'inventory full'
    expect(p.self.energy).toBe(7); // → foresee 'too exhausted'
    expect(p.tiles.every((t) => typeof t.passable === 'boolean')).toBe(true); // → 'blocked terrain'
    const node = p.tiles.find((t) => t.resource);
    expect(node?.resource).toEqual({ item: 'grain', stock: 4 }); // → 'nothing to gather here'
    const ground = p.tiles.find((t) => t.ground);
    expect(ground?.ground).toEqual({ water: 2 });
  });
});
