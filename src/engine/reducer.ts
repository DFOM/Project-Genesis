// applyEvent — the SINGLE place world state ever changes. Both live simulation and replay fold
// this exact reducer over the exact same events, so replay equality is structural, not
// coincidental. The reducer is deterministic and does no I/O and no rng draws.
//
// Two responsibilities per event: (1) apply the concrete state change the referee computed
// (`applyStateChange`), then (2) update the derived, bounded per-agent memory (`recordMemory`) —
// including SOCIAL memory: an agent records acts it WITNESSED within its perception radius. Both
// fold through applyEvent, so replay reconstructs memory identically (proven by test:determinism).
//
// PURITY NOTE: "pure" = deterministic + no I/O + no clock/Math.random (CLAUDE.md invariant #1) —
// NOT immutability. For a 5,000-tick run we mutate the working World in place and return it.
//
// GENESIS is the ONLY event that accepts a null world — it constructs the whole thing.
import { buildWorld } from './genesis.js';
import { idx } from './types.js';
import * as C from './config.js';
import { remember } from './memory.js';
import type { Agent, Ground, ResourceNode, Vec, World } from './types.js';
import type { ItemType } from './contract.js';
import type { Event } from './events.js';

function requireWorld(world: World | null, type: string): World {
  if (world === null) throw new Error(`event ${type} arrived before GENESIS constructed the world`);
  return world;
}

function agent(world: World, id: string): Agent {
  const a = world.agents.find((x) => x.id === id);
  if (!a) throw new Error(`unknown agent ${id}`);
  return a;
}

function nodeAt(world: World, x: number, y: number): ResourceNode {
  const n = world.nodes.find((nn) => nn.pos.x === x && nn.pos.y === y);
  if (!n) throw new Error(`no node at (${x},${y})`);
  return n;
}

function addGround(g: Ground, item: ItemType, delta: number): void {
  const next = (g[item] ?? 0) + delta;
  if (next <= 0) delete g[item]; // keep the canonical form stable: never store a zero
  else g[item] = next;
}

export function applyEvent(world: World | null, e: Event): World {
  if (e.type === 'GENESIS') return buildWorld(e.config);
  const w = requireWorld(world, e.type);
  applyStateChange(w, e);
  recordMemory(w, e);
  return w;
}

// ── (1) concrete state change (unchanged Phase-1 semantics) ──────────────────
function applyStateChange(w: World, e: Exclude<Event, { type: 'GENESIS' }>): void {
  switch (e.type) {
    case 'MOVED': {
      const a = agent(w, e.agentId);
      a.pos = { x: e.to.x, y: e.to.y };
      a.energy = e.energyAfter;
      return;
    }
    case 'GATHERED': {
      const a = agent(w, e.agentId);
      a.inventory[e.item] += e.qty;
      if (e.source === 'node') nodeAt(w, e.tile.x, e.tile.y).stock -= e.qty;
      else addGround(w.ground[idx(w.size, e.tile.x, e.tile.y)]!, e.item, -e.qty);
      return;
    }
    case 'ATE': {
      const a = agent(w, e.agentId);
      a.inventory[e.item] -= 1;
      a.satiation = e.satiationAfter;
      return;
    }
    case 'DRANK': {
      const a = agent(w, e.agentId);
      a.inventory[e.item] -= 1;
      a.hydration = e.hydrationAfter;
      return;
    }
    case 'DROPPED': {
      const a = agent(w, e.agentId);
      a.inventory[e.item] -= e.qty;
      addGround(w.ground[idx(w.size, e.tile.x, e.tile.y)]!, e.item, e.qty);
      return;
    }
    case 'RESTED':
      agent(w, e.agentId).energy = e.energyAfter;
      return;
    case 'REGEN':
      nodeAt(w, e.tile.x, e.tile.y).stock += e.amount;
      return;
    case 'METABOLIZED':
      for (const d of e.deltas) {
        const a = agent(w, d.agentId);
        a.satiation = d.satiationAfter;
        a.hydration = d.hydrationAfter;
        a.health = d.healthAfter;
        a.starvingTicks = d.starvingTicksAfter;
        a.dehydratingTicks = d.dehydratingTicksAfter;
      }
      return;
    case 'AGENT_DIED':
      agent(w, e.agentId).alive = false;
      return;
    case 'ACTION_REJECTED':
      return; // a rejection changes no world state — but IS remembered (recordMemory)
    case 'TICK_COMPLETED':
      w.tick = e.tick;
      w.rng = e.rng;
      return;
    default: {
      const _exhaustive: never = e;
      throw new Error(`unhandled event ${JSON.stringify(_exhaustive)}`);
    }
  }
}

// ── (2) derived memory (own + social/witnessed) ─────────────────────────────
// Agents (alive, ≠ actor) within PERCEPTION_RADIUS of `tile` — they observed the act.
function witnesses(w: World, tile: Vec, excludeId: string): Agent[] {
  const r = C.PERCEPTION_RADIUS;
  const out: Agent[] = [];
  for (const a of w.agents) {
    if (!a.alive || a.id === excludeId) continue;
    if (Math.abs(a.pos.x - tile.x) <= r && Math.abs(a.pos.y - tile.y) <= r) out.push(a);
  }
  return out;
}

// Was the tile emptied by this gather? (drives witnessed_gathered.lastUnit).
function nothingLeftAt(w: World, tile: Vec): boolean {
  const node = w.nodes.find((n) => n.pos.x === tile.x && n.pos.y === tile.y);
  if (node && node.stock > 0) return false;
  const g = w.ground[idx(w.size, tile.x, tile.y)]!;
  for (const k of Object.keys(g) as ItemType[]) if ((g[k] ?? 0) > 0) return false;
  return true;
}

function recordMemory(w: World, e: Exclude<Event, { type: 'GENESIS' }>): void {
  const now = w.tick; // action events: pre-increment tick; TICK_COMPLETED: already the new tick
  switch (e.type) {
    case 'GATHERED': {
      remember(agent(w, e.agentId).memory, { tick: now, kind: 'gathered', item: e.item, qty: e.qty }, now);
      const lastUnit = nothingLeftAt(w, e.tile);
      for (const obs of witnesses(w, e.tile, e.agentId))
        remember(obs.memory, { tick: now, kind: 'witnessed_gathered', who: e.agentId, item: e.item, qty: e.qty, tile: { x: e.tile.x, y: e.tile.y }, lastUnit }, now);
      return;
    }
    case 'ATE':
      remember(agent(w, e.agentId).memory, { tick: now, kind: 'ate', item: e.item }, now);
      return;
    case 'DRANK':
      remember(agent(w, e.agentId).memory, { tick: now, kind: 'drank', item: e.item }, now);
      return;
    case 'DROPPED': {
      remember(agent(w, e.agentId).memory, { tick: now, kind: 'dropped', item: e.item, qty: e.qty }, now);
      for (const obs of witnesses(w, e.tile, e.agentId))
        remember(obs.memory, { tick: now, kind: 'witnessed_dropped', who: e.agentId, item: e.item, qty: e.qty, tile: { x: e.tile.x, y: e.tile.y } }, now);
      return;
    }
    case 'RESTED':
      remember(agent(w, e.agentId).memory, { tick: now, kind: 'rested' }, now);
      return;
    case 'ACTION_REJECTED':
      remember(agent(w, e.agentId).memory, { tick: now, kind: 'rejected', action: e.action, reason: e.reason }, now);
      return;
    case 'METABOLIZED':
      for (const d of e.deltas) {
        // starving/dehydrating counters == 1 mark the FIRST tick the need hit 0 (the onset).
        const starveOnset = d.starvingTicksAfter === 1;
        const dehydrateOnset = d.dehydratingTicksAfter === 1;
        if (starveOnset) remember(agent(w, d.agentId).memory, { tick: now, kind: 'starving' }, now);
        if (dehydrateOnset) remember(agent(w, d.agentId).memory, { tick: now, kind: 'dehydrating' }, now);
        if (starveOnset || dehydrateOnset) {
          const a = agent(w, d.agentId);
          for (const obs of witnesses(w, a.pos, a.id)) remember(obs.memory, { tick: now, kind: 'witnessed_distress', who: a.id }, now);
        }
      }
      return;
    case 'AGENT_DIED': {
      const a = agent(w, e.agentId);
      for (const obs of witnesses(w, a.pos, e.agentId))
        remember(obs.memory, { tick: now, kind: 'witnessed_died', who: e.agentId, cause: e.cause, tile: { x: a.pos.x, y: a.pos.y } }, now);
      return;
    }
    case 'TICK_COMPLETED': {
      // Diff each agent's current in-radius agent set against last tick → appeared/departed.
      const r = C.PERCEPTION_RADIUS;
      for (const a of w.agents) {
        if (!a.alive) continue;
        const current: string[] = [];
        for (const b of w.agents) {
          if (b.id === a.id || !b.alive) continue;
          if (Math.abs(b.pos.x - a.pos.x) <= r && Math.abs(b.pos.y - a.pos.y) <= r) current.push(b.id);
        }
        current.sort();
        const last = new Set(a.lastVisible);
        const cur = new Set(current);
        for (const id of current) if (!last.has(id)) remember(a.memory, { tick: now, kind: 'appeared', who: id }, now);
        for (const id of a.lastVisible) if (!cur.has(id)) remember(a.memory, { tick: now, kind: 'departed', who: id }, now);
        a.lastVisible = current;
      }
      return;
    }
    case 'MOVED':
    case 'REGEN':
      return; // no memory (a move is noise; regen is invisible)
    default: {
      const _exhaustive: never = e;
      throw new Error(`unhandled event ${JSON.stringify(_exhaustive)}`);
    }
  }
}
