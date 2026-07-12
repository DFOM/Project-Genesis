// Instrumentation to answer "why do agents die?" — supply vs demand, node depletion, contest
// rate, rejection histogram, and per-death forensics. It runs an OBSERVED copy of the sim
// loop (its own perceive→propose→step), so it can inspect proposals, events, and world state
// every tick without touching the pure engine. Used by `sim:diagnose` and `test:scarcity`.
import { applyEvent, perceive, config as C } from '../engine/index.js';
import type { Event, ItemType, ProposedAction, World } from '../engine/index.js';
import { step } from '../referee/index.js';
import { heuristicBot } from '../agents/index.js';
import { makeConfig } from './harness.js';

export interface DeathRecord {
  tick: number;
  x: number;
  y: number;
  cause: 'starvation' | 'dehydration';
  distNearestGrain: number;
  distNearestWater: number;
  nearestRelevantDist: number; // to the resource the agent lacked (grain if starved, water if dehydrated)
  nearestRelevantStock: number; // that node's stock at death — 0 ⇒ depleted
  classification: 'search-failure' | 'competition';
}

export interface DiagnosticReport {
  seed: number;
  ticks: number;
  alive: number;
  dead: number;
  // supply vs demand (per resource, per tick)
  grainRegenCapacity: number; // regen rate × node count (max the world can produce)
  waterRegenCapacity: number;
  grainRegenDelivered: number; // actually emitted REGEN, respecting caps (avg/tick)
  waterRegenDelivered: number;
  grainConsumedPerTick: number; // ATE units / tick
  waterConsumedPerTick: number;
  grainSupplyDemandRatio: number; // capacity : consumption
  waterSupplyDemandRatio: number;
  // node depletion (grain + water nodes only; ore is inert)
  nodeZeroFraction: number; // fraction of (node,tick) trough samples at stock 0
  nodeLowFraction: number; // fraction of trough samples below GATHER_QTY (can't serve a full gather)
  nodeStockMedian: number;
  nodeStockMax: number;
  // society-formation precondition: how crowded is perception?
  meanVisibleAgents: number; // avg number of OTHER agents in a living agent's perception, per tick
  // contest
  contestedGatherTicks: number; // ticks with ≥2 agents proposing GATHER on the same node
  lastUnitDecisions: number; // same tick, same node: someone GATHERED and someone got 'nothing to gather here'
  // rejections
  rejections: Record<string, number>;
  // deaths
  deaths: DeathRecord[];
  searchFailureDeaths: number;
  competitionDeaths: number;
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

export function diagnose(seed: number, ticks: number): DiagnosticReport {
  const genesis: Event = { type: 'GENESIS', config: makeConfig(seed) };
  let world: World = applyEvent(null, genesis);
  const minds = new Map(world.agents.map((a) => [a.id, heuristicBot(a.id)]));

  // Fixed node positions (nodes never move); used for death-distance forensics.
  const grainPos = world.nodes.filter((n) => n.item === 'grain').map((n) => ({ x: n.pos.x, y: n.pos.y }));
  const waterPos = world.nodes.filter((n) => n.item === 'water').map((n) => ({ x: n.pos.x, y: n.pos.y }));
  const grainCount = grainPos.length;
  const waterCount = waterPos.length;

  let grainConsumed = 0;
  let waterConsumed = 0;
  let visibleAgentsSum = 0;
  let perceptionCount = 0;
  let grainDelivered = 0;
  let waterDelivered = 0;
  let contestedGatherTicks = 0;
  let lastUnitDecisions = 0;
  const rejections: Record<string, number> = {};
  const deaths: DeathRecord[] = [];

  // node-stock histogram over grain+water nodes, sampled at the TROUGH (after this tick's
  // gathers, before regen) — that is the stock an arriving agent actually faces. Sampling
  // after regen would hide intra-tick depletion (regen refills +1 every tick).
  const histSize = C.NODE_MAX_STOCK + 1;
  const stockHist = new Uint32Array(histSize);
  let nodeSamples = 0;
  let nodeLowSamples = 0; // trough < GATHER_QTY (can't serve a full gather)
  const gwNodeKeys = world.nodes.filter((n) => n.item !== 'ore').map((n) => `${n.pos.x},${n.pos.y}`);
  const liveStock = new Map<string, number>();
  for (const n of world.nodes) if (n.item !== 'ore') liveStock.set(`${n.pos.x},${n.pos.y}`, n.stock);

  const nearestDist = (x: number, y: number, positions: { x: number; y: number }[]): number => {
    let best = Infinity;
    for (const p of positions) {
      const d = manhattan(x, y, p.x, p.y);
      if (d < best) best = d;
    }
    return best;
  };

  for (let t = 0; t < ticks; t++) {
    // 1) Collect proposals (mirrors the orchestrator), tracking GATHER proposals per node tile.
    const proposals: ProposedAction[] = [];
    const gatherByTile = new Map<string, number>();
    for (const a of world.agents) {
      if (!a.alive) continue;
      const p = perceive(world, a.id);
      visibleAgentsSum += p.agents.length;
      perceptionCount++;
      const proposed = minds.get(a.id)!.propose(p);
      const actions = Array.isArray(proposed) ? proposed : []; // heuristic bots are synchronous
      for (const action of actions) {
        proposals.push({ agentId: a.id, action });
        if (action.type === 'GATHER') {
          const key = `${a.pos.x},${a.pos.y}`;
          gatherByTile.set(key, (gatherByTile.get(key) ?? 0) + 1);
        }
      }
    }
    // A tick is "contested" if ≥2 agents proposed GATHER while standing on the same node.
    let contestedThisTick = false;
    for (const [key, n] of gatherByTile) {
      if (n < 2) continue;
      const [x, y] = key.split(',').map(Number) as [number, number];
      if (world.nodes.some((nd) => nd.pos.x === x && nd.pos.y === y)) contestedThisTick = true;
    }
    if (contestedThisTick) contestedGatherTicks++;

    // 2) Advance one tick.
    const result = step(world, proposals);
    world = result.world;
    const events = result.events;

    // 3) Tally from events.
    const gatheredTiles = new Set<string>();
    const emptyRejectTiles = new Set<string>();
    for (const e of events) {
      switch (e.type) {
        case 'ATE':
          grainConsumed++;
          break;
        case 'DRANK':
          waterConsumed++;
          break;
        case 'REGEN': {
          const node = world.nodes.find((n) => n.pos.x === e.tile.x && n.pos.y === e.tile.y);
          if (node?.item === 'grain') grainDelivered += e.amount;
          else if (node?.item === 'water') waterDelivered += e.amount;
          break;
        }
        case 'GATHERED':
          gatheredTiles.add(`${e.tile.x},${e.tile.y}`);
          break;
        case 'ACTION_REJECTED': {
          rejections[e.reason] = (rejections[e.reason] ?? 0) + 1;
          if (e.action.type === 'GATHER' && e.reason === 'nothing to gather here') {
            const a = world.agents.find((x) => x.id === e.agentId);
            if (a) emptyRejectTiles.add(`${a.pos.x},${a.pos.y}`);
          }
          break;
        }
        case 'AGENT_DIED': {
          const a = world.agents.find((x) => x.id === e.agentId)!;
          const item: ItemType = e.cause === 'starvation' ? 'grain' : 'water';
          const relNodes = world.nodes.filter((n) => n.item === item);
          let nearestRelDist = Infinity;
          let nearestRelStock = 0;
          for (const n of relNodes) {
            const d = manhattan(a.pos.x, a.pos.y, n.pos.x, n.pos.y);
            if (d < nearestRelDist) {
              nearestRelDist = d;
              nearestRelStock = n.stock;
            }
          }
          // Search failure: the needed resource was beyond perception (never found it).
          // Competition: a node was within perception but depleted when the agent needed it.
          const classification = nearestRelDist > C.PERCEPTION_RADIUS ? 'search-failure' : 'competition';
          deaths.push({
            tick: t + 1,
            x: a.pos.x,
            y: a.pos.y,
            cause: e.cause,
            distNearestGrain: nearestDist(a.pos.x, a.pos.y, grainPos),
            distNearestWater: nearestDist(a.pos.x, a.pos.y, waterPos),
            nearestRelevantDist: nearestRelDist,
            nearestRelevantStock: nearestRelStock,
            classification,
          });
          break;
        }
        default:
          break;
      }
    }
    // A "last-unit decision": same tick & tile, one agent GATHERED and another was told
    // 'nothing to gather here' — the seeded shuffle picked the winner of the last unit.
    for (const tile of emptyRejectTiles) if (gatheredTiles.has(tile)) lastUnitDecisions++;

    // 4) Sample node-stock TROUGH: apply this tick's gathers, snapshot, then apply regen.
    //    (Within a tick the referee emits all GATHERED before any REGEN.)
    for (const e of events) {
      if (e.type === 'GATHERED' && e.source === 'node') {
        const k = `${e.tile.x},${e.tile.y}`;
        liveStock.set(k, liveStock.get(k)! - e.qty);
      }
    }
    for (const k of gwNodeKeys) {
      const s = liveStock.get(k)!;
      stockHist[Math.max(0, Math.min(s, histSize - 1))]!++;
      nodeSamples++;
      if (s < C.GATHER_QTY) nodeLowSamples++;
    }
    for (const e of events) {
      if (e.type === 'REGEN') {
        const k = `${e.tile.x},${e.tile.y}`;
        liveStock.set(k, liveStock.get(k)! + e.amount);
      }
    }
  }

  // Node-stock median & max from the histogram.
  let median = 0;
  let seen = 0;
  const half = nodeSamples / 2;
  let maxStock = 0;
  for (let s = 0; s < histSize; s++) {
    if (stockHist[s]! > 0) maxStock = s;
    seen += stockHist[s]!;
    if (median === 0 && seen >= half) median = s;
  }
  const zeroFraction = nodeSamples > 0 ? stockHist[0]! / nodeSamples : 0;

  const grainConsumedPerTick = grainConsumed / ticks;
  const waterConsumedPerTick = waterConsumed / ticks;

  return {
    seed,
    ticks,
    alive: world.agents.filter((a) => a.alive).length,
    dead: world.agents.filter((a) => !a.alive).length,
    grainRegenCapacity: grainCount * C.NODE_REGEN_PER_TICK,
    waterRegenCapacity: waterCount * C.NODE_REGEN_PER_TICK,
    grainRegenDelivered: grainDelivered / ticks,
    waterRegenDelivered: waterDelivered / ticks,
    grainConsumedPerTick,
    waterConsumedPerTick,
    grainSupplyDemandRatio: grainConsumedPerTick > 0 ? (grainCount * C.NODE_REGEN_PER_TICK) / grainConsumedPerTick : Infinity,
    waterSupplyDemandRatio: waterConsumedPerTick > 0 ? (waterCount * C.NODE_REGEN_PER_TICK) / waterConsumedPerTick : Infinity,
    nodeZeroFraction: zeroFraction,
    nodeLowFraction: nodeSamples > 0 ? nodeLowSamples / nodeSamples : 0,
    nodeStockMedian: median,
    nodeStockMax: maxStock,
    meanVisibleAgents: perceptionCount > 0 ? visibleAgentsSum / perceptionCount : 0,
    contestedGatherTicks,
    lastUnitDecisions,
    rejections,
    deaths,
    searchFailureDeaths: deaths.filter((d) => d.classification === 'search-failure').length,
    competitionDeaths: deaths.filter((d) => d.classification === 'competition').length,
  };
}

export function formatReport(r: DiagnosticReport): string {
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`GENESIS diagnostics — seed ${r.seed}, ${r.ticks} ticks`);
  lines.push(`  survivors: ${r.alive} alive / ${r.dead} dead`);
  lines.push('');
  lines.push('SUPPLY vs DEMAND (per tick, per resource)');
  lines.push(`  grain: regen capacity ${r.grainRegenCapacity.toFixed(1)} (delivered ${r.grainRegenDelivered.toFixed(2)}) vs consumed ${r.grainConsumedPerTick.toFixed(3)}  →  ${r.grainSupplyDemandRatio.toFixed(0)}:1`);
  lines.push(`  water: regen capacity ${r.waterRegenCapacity.toFixed(1)} (delivered ${r.waterRegenDelivered.toFixed(2)}) vs consumed ${r.waterConsumedPerTick.toFixed(3)}  →  ${r.waterSupplyDemandRatio.toFixed(0)}:1`);
  lines.push('');
  lines.push('NODE DEPLETION (grain + water nodes, trough per tick)');
  lines.push(`  node-ticks at zero stock: ${pct(r.nodeZeroFraction)}`);
  lines.push(`  node-ticks below a full gather (< ${C.GATHER_QTY}): ${pct(r.nodeLowFraction)}`);
  lines.push(`  trough stock median: ${r.nodeStockMedian}   max observed: ${r.nodeStockMax}`);
  lines.push('');
  lines.push('AGENT VISIBILITY');
  lines.push(`  mean other agents in perception, per agent per tick: ${r.meanVisibleAgents.toFixed(2)}`);
  lines.push('');
  lines.push('CONTEST');
  lines.push(`  ticks with ≥2 agents gathering the same node: ${r.contestedGatherTicks}`);
  lines.push(`  last-unit decisions (shuffle picked the winner): ${r.lastUnitDecisions}`);
  lines.push('');
  lines.push('REJECTIONS');
  for (const [reason, n] of Object.entries(r.rejections).sort((a, b) => b[1] - a[1])) {
    lines.push(`  ${reason}: ${n}`);
  }
  lines.push('');
  lines.push('DEATH FORENSICS');
  lines.push(`  ${r.searchFailureDeaths} search-failure  /  ${r.competitionDeaths} competition  (of ${r.deaths.length})`);
  // death-tick distribution (per 500-tick bucket) — reveals a single cull vs deaths across the run
  if (r.deaths.length > 0) {
    const bucket = 500;
    const buckets = new Map<number, number>();
    for (const d of r.deaths) buckets.set(Math.floor((d.tick - 1) / bucket), (buckets.get(Math.floor((d.tick - 1) / bucket)) ?? 0) + 1);
    const spans: string[] = [];
    for (const b of [...buckets.keys()].sort((a, z) => a - z)) spans.push(`${b * bucket}-${(b + 1) * bucket}: ${buckets.get(b)}`);
    lines.push(`  death-tick distribution [${spans.join('  ')}]`);
  }
  for (const d of r.deaths) {
    lines.push(
      `  tick ${String(d.tick).padStart(4)}  (${String(d.x).padStart(2)},${String(d.y).padStart(2)})  ${d.cause.padEnd(11)}  ` +
        `nearest grain ${String(d.distNearestGrain).padStart(3)}  water ${String(d.distNearestWater).padStart(3)}  ` +
        `[needed dist ${d.nearestRelevantDist === Infinity ? '∞' : d.nearestRelevantDist}, stock ${d.nearestRelevantStock}]  → ${d.classification}`,
    );
  }
  return lines.join('\n');
}
